/**
 * electron/services/terminal.ts
 *
 * Streaming command execution service for the Terminal Portal:
 *   - executeRemote()  — run a command on a remote server via WinRM/PowerShell
 *   - executeLocal()   — run a command on the local machine via PowerShell
 *   - pingHost()       — stream ping output line-by-line
 *
 * All functions use child_process.spawn (not exec) so output is streamed
 * in real-time rather than buffered until process exit. Partial-line data
 * is buffered internally until a newline is received before being emitted.
 */

import { spawn } from 'child_process'
import os from 'os'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
  durationMs: number
}

export interface CommandCallbacks {
  /** Called for each line of stdout as it arrives */
  onOutput: (line: string) => void
  /** Called for each line of stderr as it arrives */
  onError: (line: string) => void
  /** Called once when the process exits */
  onComplete: (result: CommandResult) => void
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Returns a handler for child_process `data` events that buffers partial
 * lines and flushes complete lines (split on \n) via the provided callback.
 * The flush function drains any remaining buffer content when the process
 * closes (pass the returned `flush` to the `close` handler).
 */
function makeLineBuffer(callback: (line: string) => void): {
  onData: (chunk: Buffer) => void
  flush: () => string
} {
  let buffer = ''

  function onData(chunk: Buffer): void {
    // Normalize Windows CRLF to LF before splitting
    buffer += chunk.toString('utf8').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
    const lines = buffer.split('\n')
    // Keep the last element — it may be a partial line
    buffer = lines.pop() ?? ''
    for (const line of lines) {
      callback(line)
    }
  }

  function flush(): string {
    const remaining = buffer
    buffer = ''
    // Emit whatever is left (no trailing newline)
    if (remaining.length > 0) {
      callback(remaining)
    }
    return remaining
  }

  return { onData, flush }
}

/**
 * Encodes a PowerShell command to base64 UTF-16LE so it can be passed via
 * -EncodedCommand without any shell quoting/escaping issues.
 */
function encodePowerShell(command: string): string {
  return Buffer.from(command, 'utf16le').toString('base64')
}

// ─── executeRemote ────────────────────────────────────────────────────────────

/**
 * Execute a command on a remote server via WinRM (Invoke-Command).
 *
 * The ScriptBlock wraps the raw command string so the caller does not need
 * to worry about PowerShell encoding. Credentials are forwarded as a
 * PSCredential if provided.
 */
export function executeRemote(
  targetIP: string,
  command: string,
  callbacks: CommandCallbacks,
  credential?: { username: string; password: string },
): { cancel: () => void } {
  const startTime = Date.now()
  let stdoutAccum = ''
  let stderrAccum = ''

  // Build the Invoke-Command script.
  // The inner command is embedded directly; callers are responsible for
  // ensuring the command string is safe (this is an internal admin tool).
  let psScript: string

  if (credential) {
    // Build a PSCredential and pass it to Invoke-Command
    psScript = [
      `$pass = ConvertTo-SecureString -String '${credential.password.replace(/'/g, "''")}' -AsPlainText -Force`,
      `$cred = New-Object System.Management.Automation.PSCredential('${credential.username.replace(/'/g, "''")}', $pass)`,
      `Invoke-Command -ComputerName '${targetIP}' -Credential $cred -ScriptBlock { ${command} }`,
    ].join('; ')
  } else {
    psScript = `Invoke-Command -ComputerName '${targetIP}' -ScriptBlock { ${command} }`
  }

  const encoded = encodePowerShell(psScript)

  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-OutputFormat', 'Text',
    '-EncodedCommand', encoded,
  ], {
    windowsHide: true,
  })

  const stdoutBuffer = makeLineBuffer((line) => {
    stdoutAccum += line + '\n'
    callbacks.onOutput(line)
  })

  const stderrBuffer = makeLineBuffer((line) => {
    stderrAccum += line + '\n'
    callbacks.onError(line)
  })

  child.stdout.on('data', stdoutBuffer.onData)
  child.stderr.on('data', stderrBuffer.onData)

  child.on('error', (err) => {
    const msg = `PowerShell spawn error: ${err.message}`
    stderrAccum += msg + '\n'
    callbacks.onError(msg)
    callbacks.onComplete({
      stdout: stdoutAccum.trimEnd(),
      stderr: stderrAccum.trimEnd(),
      exitCode: 1,
      durationMs: Date.now() - startTime,
    })
  })

  child.on('close', (code) => {
    // Flush any buffered partial line from each stream
    stdoutBuffer.flush()
    stderrBuffer.flush()
    callbacks.onComplete({
      stdout: stdoutAccum.trimEnd(),
      stderr: stderrAccum.trimEnd(),
      exitCode: code ?? 1,
      durationMs: Date.now() - startTime,
    })
  })

  return {
    cancel: () => {
      child.kill()
    },
  }
}

// ─── executeLocal ─────────────────────────────────────────────────────────────

/**
 * Execute a command on the LOCAL machine via PowerShell.
 *
 * The command is base64-encoded to avoid quoting issues. Output is streamed
 * line-by-line via callbacks.
 */
export function executeLocal(
  command: string,
  callbacks: CommandCallbacks,
): { cancel: () => void } {
  const startTime = Date.now()
  let stdoutAccum = ''
  let stderrAccum = ''

  const encoded = encodePowerShell(command)

  const child = spawn('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-OutputFormat', 'Text',
    '-EncodedCommand', encoded,
  ], {
    windowsHide: true,
  })

  const stdoutBuffer = makeLineBuffer((line) => {
    stdoutAccum += line + '\n'
    callbacks.onOutput(line)
  })

  const stderrBuffer = makeLineBuffer((line) => {
    stderrAccum += line + '\n'
    callbacks.onError(line)
  })

  child.stdout.on('data', stdoutBuffer.onData)
  child.stderr.on('data', stderrBuffer.onData)

  child.on('error', (err) => {
    const msg = `PowerShell spawn error: ${err.message}`
    stderrAccum += msg + '\n'
    callbacks.onError(msg)
    callbacks.onComplete({
      stdout: stdoutAccum.trimEnd(),
      stderr: stderrAccum.trimEnd(),
      exitCode: 1,
      durationMs: Date.now() - startTime,
    })
  })

  child.on('close', (code) => {
    stdoutBuffer.flush()
    stderrBuffer.flush()
    callbacks.onComplete({
      stdout: stdoutAccum.trimEnd(),
      stderr: stderrAccum.trimEnd(),
      exitCode: code ?? 1,
      durationMs: Date.now() - startTime,
    })
  })

  return {
    cancel: () => {
      child.kill()
    },
  }
}

// ─── pingHost ─────────────────────────────────────────────────────────────────

/**
 * Ping a target IP and stream each response line as it arrives.
 *
 * Uses the native `ping` binary (not PowerShell) so output appears
 * line-by-line without waiting for all pings to complete.
 *
 * Windows: ping -n {count} {target}
 * Other:   ping -c {count} {target}
 */
export function pingHost(
  targetIP: string,
  count: number = 4,
  callbacks: CommandCallbacks,
): { cancel: () => void } {
  const startTime = Date.now()
  let stdoutAccum = ''
  let stderrAccum = ''

  const isWindows = os.platform() === 'win32'
  const pingArgs = isWindows
    ? ['-n', String(count), targetIP]
    : ['-c', String(count), targetIP]

  const child = spawn('ping', pingArgs, {
    // On Windows, ping is a console app — windowsHide prevents a flash
    windowsHide: true,
  })

  const stdoutBuffer = makeLineBuffer((line) => {
    stdoutAccum += line + '\n'
    callbacks.onOutput(line)
  })

  const stderrBuffer = makeLineBuffer((line) => {
    stderrAccum += line + '\n'
    callbacks.onError(line)
  })

  child.stdout.on('data', stdoutBuffer.onData)
  child.stderr.on('data', stderrBuffer.onData)

  child.on('error', (err) => {
    const msg = `ping spawn error: ${err.message}`
    stderrAccum += msg + '\n'
    callbacks.onError(msg)
    callbacks.onComplete({
      stdout: stdoutAccum.trimEnd(),
      stderr: stderrAccum.trimEnd(),
      exitCode: 1,
      durationMs: Date.now() - startTime,
    })
  })

  child.on('close', (code) => {
    stdoutBuffer.flush()
    stderrBuffer.flush()
    callbacks.onComplete({
      stdout: stdoutAccum.trimEnd(),
      stderr: stderrAccum.trimEnd(),
      exitCode: code ?? 1,
      durationMs: Date.now() - startTime,
    })
  })

  return {
    cancel: () => {
      child.kill()
    },
  }
}
