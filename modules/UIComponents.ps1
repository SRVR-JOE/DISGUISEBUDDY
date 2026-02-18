# UIComponents.ps1 - DISGUISE BUDDY Reusable UI Component Factories
# All functions reference $script:Theme which is set by Theme.ps1 (dot-sourced first)

function New-StyledButton {
    <#
    .SYNOPSIS
        Creates a flat-style button with theme colors and optional hover effects.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text,

        [Parameter(Mandatory = $true)]
        [int]$X,

        [Parameter(Mandatory = $true)]
        [int]$Y,

        [int]$Width = 120,
        [int]$Height = 35,
        [switch]$IsPrimary,
        [switch]$IsDestructive,
        [scriptblock]$OnClick
    )

    $button = New-Object System.Windows.Forms.Button
    $button.Text = $Text
    $button.Location = New-Object System.Drawing.Point($X, $Y)
    $button.Size = New-Object System.Drawing.Size($Width, $Height)
    $button.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat
    $button.FlatAppearance.BorderSize = 0
    $button.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
    $button.Cursor = [System.Windows.Forms.Cursors]::Hand

    if ($IsPrimary) {
        $button.BackColor = $script:Theme.Primary
        $button.ForeColor = [System.Drawing.Color]::White
    } elseif ($IsDestructive) {
        $button.BackColor = $script:Theme.Error
        $button.ForeColor = [System.Drawing.Color]::White
    } else {
        $button.BackColor = $script:Theme.Surface
        $button.ForeColor = $script:Theme.Text
    }

    # Store the original background color for hover restore
    $originalBackColor = $button.BackColor

    # Hover effects
    $button.Add_MouseEnter({
        if ($this.BackColor -eq $script:Theme.Primary) {
            $this.BackColor = $script:Theme.PrimaryLight
        } elseif ($this.BackColor -eq $script:Theme.Error) {
            # Lighten the error color slightly for hover
            $r = [Math]::Min(255, $this.BackColor.R + 20)
            $g = [Math]::Min(255, $this.BackColor.G + 20)
            $b = [Math]::Min(255, $this.BackColor.B + 20)
            $this.BackColor = [System.Drawing.Color]::FromArgb($r, $g, $b)
        } else {
            $this.BackColor = $script:Theme.SurfaceLight
        }
    })

    $button.Add_MouseLeave({
        if ($this.Tag -eq 'Primary') {
            $this.BackColor = $script:Theme.Primary
        } elseif ($this.Tag -eq 'Destructive') {
            $this.BackColor = $script:Theme.Error
        } else {
            $this.BackColor = $script:Theme.Surface
        }
    })

    # Set Tag to identify button type for MouseLeave restore
    if ($IsPrimary) {
        $button.Tag = 'Primary'
    } elseif ($IsDestructive) {
        $button.Tag = 'Destructive'
    } else {
        $button.Tag = 'Normal'
    }

    # Attach click handler if provided
    if ($OnClick) {
        $button.Add_Click($OnClick)
    }

    return $button
}

function New-StyledLabel {
    <#
    .SYNOPSIS
        Creates a themed label with configurable font, color, and optional word wrapping.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text,

        [Parameter(Mandatory = $true)]
        [int]$X,

        [Parameter(Mandatory = $true)]
        [int]$Y,

        [float]$FontSize = 10,
        [switch]$IsBold,
        [switch]$IsSecondary,
        [switch]$IsMuted,
        [int]$MaxWidth = 0
    )

    $label = New-Object System.Windows.Forms.Label
    $label.Text = $Text
    $label.Location = New-Object System.Drawing.Point($X, $Y)
    $label.AutoSize = $true

    # Font style
    $fontStyle = if ($IsBold) { [System.Drawing.FontStyle]::Bold } else { [System.Drawing.FontStyle]::Regular }
    $label.Font = New-Object System.Drawing.Font('Segoe UI', $FontSize, $fontStyle)

    # Text color based on switches
    if ($IsMuted) {
        $label.ForeColor = $script:Theme.TextMuted
    } elseif ($IsSecondary) {
        $label.ForeColor = $script:Theme.TextSecondary
    } else {
        $label.ForeColor = $script:Theme.Text
    }

    # Word wrapping for constrained width
    if ($MaxWidth -gt 0) {
        $label.AutoSize = $false
        $label.Width = $MaxWidth
        $label.MaximumSize = New-Object System.Drawing.Size($MaxWidth, 0)
        $label.AutoSize = $true
    }

    return $label
}

function New-StyledTextBox {
    <#
    .SYNOPSIS
        Creates a themed text input with optional placeholder text behavior.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [int]$X,

        [Parameter(Mandatory = $true)]
        [int]$Y,

        [int]$Width = 250,
        [int]$Height = 28,
        [string]$PlaceholderText = ""
    )

    $textBox = New-Object System.Windows.Forms.TextBox
    $textBox.Location = New-Object System.Drawing.Point($X, $Y)
    $textBox.Size = New-Object System.Drawing.Size($Width, $Height)
    $textBox.BackColor = $script:Theme.InputBackground
    $textBox.ForeColor = $script:Theme.Text
    $textBox.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $textBox.BorderStyle = [System.Windows.Forms.BorderStyle]::FixedSingle

    # Placeholder text behavior
    if ($PlaceholderText -ne "") {
        $textBox.Tag = $PlaceholderText
        $textBox.Text = $PlaceholderText
        $textBox.ForeColor = $script:Theme.TextMuted

        $textBox.Add_GotFocus({
            if ($this.Text -eq $this.Tag) {
                $this.Text = ''
                $this.ForeColor = $script:Theme.Text
            }
        })

        $textBox.Add_LostFocus({
            if ($this.Text -eq '' -or $this.Text -eq $null) {
                $this.Text = $this.Tag
                $this.ForeColor = $script:Theme.TextMuted
            }
        })
    }

    return $textBox
}

function New-StyledPanel {
    <#
    .SYNOPSIS
        Creates a themed panel, optionally styled as a card with padding.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [int]$X,

        [Parameter(Mandatory = $true)]
        [int]$Y,

        [Parameter(Mandatory = $true)]
        [int]$Width,

        [Parameter(Mandatory = $true)]
        [int]$Height,

        [switch]$IsCard
    )

    $panel = New-Object System.Windows.Forms.Panel
    $panel.Location = New-Object System.Drawing.Point($X, $Y)
    $panel.Size = New-Object System.Drawing.Size($Width, $Height)

    if ($IsCard) {
        $panel.BackColor = $script:Theme.CardBackground
        $panel.Padding = New-Object System.Windows.Forms.Padding(10)
    } else {
        $panel.BackColor = $script:Theme.Background
    }

    return $panel
}

function New-StyledCard {
    <#
    .SYNOPSIS
        Creates a card panel with a bold title label at the top.
        The caller adds additional controls below the title.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Title,

        [Parameter(Mandatory = $true)]
        [int]$X,

        [Parameter(Mandatory = $true)]
        [int]$Y,

        [Parameter(Mandatory = $true)]
        [int]$Width,

        [Parameter(Mandatory = $true)]
        [int]$Height
    )

    $card = New-Object System.Windows.Forms.Panel
    $card.Location = New-Object System.Drawing.Point($X, $Y)
    $card.Size = New-Object System.Drawing.Size($Width, $Height)
    $card.BackColor = $script:Theme.CardBackground
    $card.Padding = New-Object System.Windows.Forms.Padding(15)

    # Title label at the top of the card
    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = $Title
    $titleLabel.Location = New-Object System.Drawing.Point(15, 15)
    $titleLabel.AutoSize = $true
    $titleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 11, [System.Drawing.FontStyle]::Bold)
    $titleLabel.ForeColor = $script:Theme.Text

    $card.Controls.Add($titleLabel)

    return $card
}

function New-StyledComboBox {
    <#
    .SYNOPSIS
        Creates a themed dropdown (ComboBox) with DropDownList style.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [int]$X,

        [Parameter(Mandatory = $true)]
        [int]$Y,

        [int]$Width = 250,
        [string[]]$Items = @()
    )

    $comboBox = New-Object System.Windows.Forms.ComboBox
    $comboBox.Location = New-Object System.Drawing.Point($X, $Y)
    $comboBox.Width = $Width
    $comboBox.DropDownStyle = [System.Windows.Forms.ComboBoxStyle]::DropDownList
    $comboBox.BackColor = $script:Theme.InputBackground
    $comboBox.ForeColor = $script:Theme.Text
    $comboBox.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $comboBox.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

    # Add items from the provided array
    if ($Items -and $Items.Count -gt 0) {
        foreach ($item in $Items) {
            $comboBox.Items.Add($item) | Out-Null
        }
    }

    return $comboBox
}

function New-StyledCheckBox {
    <#
    .SYNOPSIS
        Creates a themed checkbox with flat style.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text,

        [Parameter(Mandatory = $true)]
        [int]$X,

        [Parameter(Mandatory = $true)]
        [int]$Y
    )

    $checkBox = New-Object System.Windows.Forms.CheckBox
    $checkBox.Text = $Text
    $checkBox.Location = New-Object System.Drawing.Point($X, $Y)
    $checkBox.AutoSize = $true
    $checkBox.ForeColor = $script:Theme.Text
    $checkBox.Font = New-Object System.Drawing.Font('Segoe UI', 10)
    $checkBox.FlatStyle = [System.Windows.Forms.FlatStyle]::Flat

    return $checkBox
}

function New-StyledGroupBox {
    <#
    .SYNOPSIS
        Creates a themed group box with bold title and surface background.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text,

        [Parameter(Mandatory = $true)]
        [int]$X,

        [Parameter(Mandatory = $true)]
        [int]$Y,

        [Parameter(Mandatory = $true)]
        [int]$Width,

        [Parameter(Mandatory = $true)]
        [int]$Height
    )

    $groupBox = New-Object System.Windows.Forms.GroupBox
    $groupBox.Text = $Text
    $groupBox.Location = New-Object System.Drawing.Point($X, $Y)
    $groupBox.Size = New-Object System.Drawing.Size($Width, $Height)
    $groupBox.ForeColor = $script:Theme.Text
    $groupBox.Font = New-Object System.Drawing.Font('Segoe UI', 10, [System.Drawing.FontStyle]::Bold)
    $groupBox.BackColor = $script:Theme.Surface

    return $groupBox
}

function New-SectionHeader {
    <#
    .SYNOPSIS
        Creates a section header with a bold title and a horizontal line beneath it.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text,

        [Parameter(Mandatory = $true)]
        [int]$X,

        [Parameter(Mandatory = $true)]
        [int]$Y,

        [int]$Width = 700
    )

    # Container panel for the header and line
    $headerPanel = New-Object System.Windows.Forms.Panel
    $headerPanel.Location = New-Object System.Drawing.Point($X, $Y)
    $headerPanel.Size = New-Object System.Drawing.Size($Width, 40)
    $headerPanel.BackColor = [System.Drawing.Color]::Transparent

    # Bold title label
    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = $Text
    $titleLabel.Location = New-Object System.Drawing.Point(0, 0)
    $titleLabel.AutoSize = $true
    $titleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
    $titleLabel.ForeColor = $script:Theme.Text

    # Horizontal line beneath the title (1px tall panel)
    $line = New-Object System.Windows.Forms.Panel
    $line.Location = New-Object System.Drawing.Point(0, 32)
    $line.Size = New-Object System.Drawing.Size($Width, 1)
    $line.BackColor = $script:Theme.Border

    $headerPanel.Controls.Add($titleLabel)
    $headerPanel.Controls.Add($line)

    return $headerPanel
}

function New-StatusBadge {
    <#
    .SYNOPSIS
        Creates a small colored badge/label indicating status.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [string]$Text,

        [Parameter(Mandatory = $true)]
        [int]$X,

        [Parameter(Mandatory = $true)]
        [int]$Y,

        [ValidateSet('Success', 'Warning', 'Error', 'Info')]
        [string]$Type = 'Info'
    )

    $badge = New-Object System.Windows.Forms.Label
    $badge.Text = $Text
    $badge.Location = New-Object System.Drawing.Point($X, $Y)
    $badge.AutoSize = $true
    $badge.Font = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)
    $badge.ForeColor = [System.Drawing.Color]::White
    $badge.Padding = New-Object System.Windows.Forms.Padding(3)

    # Set background color based on type
    switch ($Type) {
        'Success' { $badge.BackColor = $script:Theme.Success }
        'Warning' { $badge.BackColor = $script:Theme.Warning }
        'Error'   { $badge.BackColor = $script:Theme.Error }
        'Info'    { $badge.BackColor = $script:Theme.Accent }
    }

    return $badge
}

function New-StyledDataGridView {
    <#
    .SYNOPSIS
        Creates a themed DataGridView with consistent styling for tabular data.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [int]$X,

        [Parameter(Mandatory = $true)]
        [int]$Y,

        [Parameter(Mandatory = $true)]
        [int]$Width,

        [Parameter(Mandatory = $true)]
        [int]$Height
    )

    $dgv = New-Object System.Windows.Forms.DataGridView
    $dgv.Location = New-Object System.Drawing.Point($X, $Y)
    $dgv.Size = New-Object System.Drawing.Size($Width, $Height)
    $dgv.BackgroundColor = $script:Theme.Surface
    $dgv.GridColor = $script:Theme.Border
    $dgv.BorderStyle = [System.Windows.Forms.BorderStyle]::None
    $dgv.CellBorderStyle = [System.Windows.Forms.DataGridViewCellBorderStyle]::SingleHorizontal
    $dgv.Font = New-Object System.Drawing.Font('Segoe UI', 9.5)
    $dgv.RowHeadersVisible = $false
    $dgv.AllowUserToAddRows = $false
    $dgv.AutoSizeColumnsMode = [System.Windows.Forms.DataGridViewAutoSizeColumnsMode]::Fill
    $dgv.SelectionMode = [System.Windows.Forms.DataGridViewSelectionMode]::FullRowSelect
    $dgv.EnableHeadersVisualStyles = $false

    # Default cell style
    $dgv.DefaultCellStyle.BackColor = $script:Theme.Surface
    $dgv.DefaultCellStyle.ForeColor = $script:Theme.Text
    $dgv.DefaultCellStyle.SelectionBackColor = $script:Theme.Primary
    $dgv.DefaultCellStyle.SelectionForeColor = [System.Drawing.Color]::White

    # Column header style
    $dgv.ColumnHeadersDefaultCellStyle.BackColor = $script:Theme.NavBackground
    $dgv.ColumnHeadersDefaultCellStyle.ForeColor = $script:Theme.Text
    $dgv.ColumnHeadersDefaultCellStyle.Font = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
    $dgv.ColumnHeadersDefaultCellStyle.SelectionBackColor = $script:Theme.NavBackground
    $dgv.ColumnHeadersDefaultCellStyle.SelectionForeColor = $script:Theme.Text

    # Alternating row style for better readability
    $dgv.AlternatingRowsDefaultCellStyle.BackColor = $script:Theme.CardBackground

    return $dgv
}

function New-ScrollPanel {
    <#
    .SYNOPSIS
        Creates a panel with AutoScroll enabled for content that may overflow.
    #>
    param(
        [Parameter(Mandatory = $true)]
        [int]$X,

        [Parameter(Mandatory = $true)]
        [int]$Y,

        [Parameter(Mandatory = $true)]
        [int]$Width,

        [Parameter(Mandatory = $true)]
        [int]$Height
    )

    $scrollPanel = New-Object System.Windows.Forms.Panel
    $scrollPanel.Location = New-Object System.Drawing.Point($X, $Y)
    $scrollPanel.Size = New-Object System.Drawing.Size($Width, $Height)
    $scrollPanel.AutoScroll = $true
    $scrollPanel.BackColor = $script:Theme.Background

    return $scrollPanel
}
