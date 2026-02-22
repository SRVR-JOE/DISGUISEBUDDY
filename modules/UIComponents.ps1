# UIComponents.ps1 - DISGUISE BUDDY Reusable UI Component Factories
# All functions reference $script:Theme which is set by Theme.ps1 (dot-sourced first)

function New-StyledButton {
    <#
    .SYNOPSIS
        Creates a flat-style button with theme colors and optional hover effects.
    .NOTES
        The button's Tag property is left free for callers to use (e.g., storing profile names).
        Original BackColor is captured in a closure variable for reliable MouseLeave restoration.
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
    $button.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Right

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

    # Bug Fix #1: Capture the original BackColor in a closure variable so that
    # MouseLeave always restores the correct color regardless of what Tag contains.
    # Previously MouseLeave checked Tag == 'Primary'/'Destructive' to decide the
    # restore color, but callers (e.g. Dashboard) overwrite Tag with their own data.
    $origBack = $button.BackColor

    # Hover effects - lighten the button on mouse enter
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

    # Restore the original background color captured at creation time
    $button.Add_MouseLeave({
        $this.BackColor = $origBack
    }.GetNewClosure())

    # Tag is intentionally NOT set here - callers are free to use it for their own data
    # (e.g., $btnQuickApply.Tag = $profileName in Dashboard.ps1)

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
    .NOTES
        Placeholder text is stored in the Tag property for callers to detect.
        Callers should check: if ($textBox.Text -eq $textBox.Tag) { treat as empty }
        Or use the helper function: Get-TextBoxValue $textBox
        The placeholder shows in TextMuted color when the field is empty/unfocused,
        and disappears on focus. It reappears if the user clears the field and leaves.
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
    $textBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right

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

function Get-TextBoxValue {
    <#
    .SYNOPSIS
        Returns the actual user-entered value from a styled text box, or empty string
        if the text box is showing placeholder text.
    .DESCRIPTION
        Use this helper to safely retrieve user input from text boxes created with
        New-StyledTextBox -PlaceholderText. It checks whether the current text matches
        the placeholder stored in the Tag property and returns empty string if so.
        This prevents placeholder text from being submitted as actual data.
    .PARAMETER TextBox
        A System.Windows.Forms.TextBox created by New-StyledTextBox.
    .EXAMPLE
        $value = Get-TextBoxValue $myTextBox
        if (-not $value) { Write-Warning "Field is empty" }
    #>
    param(
        [Parameter(Mandatory = $true)]
        [System.Windows.Forms.TextBox]$TextBox
    )

    if ($TextBox.Tag -and $TextBox.Text -eq $TextBox.Tag) {
        return ''
    }
    return $TextBox.Text
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
    $panel.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right

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
        Creates a card panel with a bold title label at the top, optional left accent
        border stripe, and consistent internal padding.
        The caller adds additional controls below the title.
    .PARAMETER AccentColor
        Optional accent color for a left border stripe (Material Design style).
        If not provided, no accent stripe is drawn.
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
        [int]$Height,

        [System.Drawing.Color]$AccentColor = [System.Drawing.Color]::Empty
    )

    $card = New-Object System.Windows.Forms.Panel
    $card.Location = New-Object System.Drawing.Point($X, $Y)
    $card.Size = New-Object System.Drawing.Size($Width, $Height)
    $card.BackColor = $script:Theme.CardBackground
    $card.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right

    # Internal content offset depends on whether an accent stripe is present
    $contentLeft = 15
    $innerPaddingLeft = 15

    # Left accent border stripe (4px wide colored bar on the left edge)
    if ($AccentColor -ne [System.Drawing.Color]::Empty) {
        $accentStripe = New-Object System.Windows.Forms.Panel
        $accentStripe.Location = New-Object System.Drawing.Point(0, 0)
        $accentStripe.Size = New-Object System.Drawing.Size(4, $Height)
        $accentStripe.BackColor = $AccentColor
        $accentStripe.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Bottom
        $card.Controls.Add($accentStripe)

        # Shift content right to accommodate the accent stripe
        $contentLeft = 19
        $innerPaddingLeft = 19
    }

    # Consistent internal padding (15px on all sides, adjusted for accent)
    $card.Padding = New-Object System.Windows.Forms.Padding($innerPaddingLeft, 15, 15, 15)

    # Subtle border for visual separation (simulates rounded-corner card appearance)
    $card.Add_Paint({
        param($sender, $e)
        $borderPen = New-Object System.Drawing.Pen($script:Theme.Border, 1)
        $rect = New-Object System.Drawing.Rectangle(0, 0, ($sender.Width - 1), ($sender.Height - 1))
        $e.Graphics.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        # Draw rounded rectangle using GraphicsPath for subtle rounded corners
        $radius = 6
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddArc($rect.X, $rect.Y, $radius, $radius, 180, 90)
        $path.AddArc(($rect.Right - $radius), $rect.Y, $radius, $radius, 270, 90)
        $path.AddArc(($rect.Right - $radius), ($rect.Bottom - $radius), $radius, $radius, 0, 90)
        $path.AddArc($rect.X, ($rect.Bottom - $radius), $radius, $radius, 90, 90)
        $path.CloseFigure()
        $e.Graphics.DrawPath($borderPen, $path)
        $borderPen.Dispose()
        $path.Dispose()
    })

    # Title label at the top of the card
    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = $Title
    $titleLabel.Location = New-Object System.Drawing.Point($contentLeft, 15)
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
    $comboBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right

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
    $groupBox.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right

    return $groupBox
}

function New-SectionHeader {
    <#
    .SYNOPSIS
        Creates a section header with a bold title and a subtle bottom border/underline
        to visually separate sections. The underline uses a 2px gradient-style accent
        line with the theme's primary color fading into the border color.
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
    $headerPanel.Size = New-Object System.Drawing.Size($Width, 42)
    $headerPanel.BackColor = [System.Drawing.Color]::Transparent
    $headerPanel.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right

    # Bold title label
    $titleLabel = New-Object System.Windows.Forms.Label
    $titleLabel.Text = $Text
    $titleLabel.Location = New-Object System.Drawing.Point(0, 0)
    $titleLabel.AutoSize = $true
    $titleLabel.Font = New-Object System.Drawing.Font('Segoe UI', 14, [System.Drawing.FontStyle]::Bold)
    $titleLabel.ForeColor = $script:Theme.Text

    # Accent underline beneath the title (2px, primary color accent that spans a portion)
    $accentLine = New-Object System.Windows.Forms.Panel
    $accentLine.Location = New-Object System.Drawing.Point(0, 33)
    $accentLine.Size = New-Object System.Drawing.Size(60, 2)
    $accentLine.BackColor = $script:Theme.Primary

    # Full-width subtle bottom border (1px, muted)
    $line = New-Object System.Windows.Forms.Panel
    $line.Location = New-Object System.Drawing.Point(0, 35)
    $line.Size = New-Object System.Drawing.Size($Width, 1)
    $line.BackColor = $script:Theme.Border
    $line.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right

    $headerPanel.Controls.Add($titleLabel)
    $headerPanel.Controls.Add($accentLine)
    $headerPanel.Controls.Add($line)

    return $headerPanel
}

function New-StatusBadge {
    <#
    .SYNOPSIS
        Creates a small colored badge/label indicating status with a pill-shaped
        background and status-specific colors.
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

    # Use a panel as the badge container for pill-shape painting
    $badge = New-Object System.Windows.Forms.Panel
    $badge.Location = New-Object System.Drawing.Point($X, $Y)
    $badge.BackColor = [System.Drawing.Color]::Transparent

    # Determine status-specific colors
    $badgeBackColor = switch ($Type) {
        'Success' { [System.Drawing.Color]::FromArgb(16, 185, 129) }   # Green #10B981
        'Warning' { [System.Drawing.Color]::FromArgb(245, 158, 11) }   # Amber #F59E0B
        'Error'   { [System.Drawing.Color]::FromArgb(239, 68, 68) }    # Red   #EF4444
        'Info'    { [System.Drawing.Color]::FromArgb(6, 182, 212) }    # Blue  #06B6D4
    }
    $badgeForeColor = [System.Drawing.Color]::White
    # Warning badges use dark text for contrast against amber background
    if ($Type -eq 'Warning') {
        $badgeForeColor = [System.Drawing.Color]::FromArgb(30, 30, 30)
    }

    $badgeFont = New-Object System.Drawing.Font('Segoe UI', 8, [System.Drawing.FontStyle]::Bold)

    # Measure text to compute consistent badge size
    $tempGraphics = [System.Drawing.Graphics]::FromHwnd([IntPtr]::Zero)
    $textSize = $tempGraphics.MeasureString($Text, $badgeFont)
    $tempGraphics.Dispose()
    $badgeWidth = [Math]::Max(([int]$textSize.Width + 16), 40)
    $badgeHeight = [Math]::Max(([int]$textSize.Height + 6), 22)

    $badge.Size = New-Object System.Drawing.Size($badgeWidth, $badgeHeight)

    # Paint handler to draw rounded pill-shaped background and centered text
    $badge.Add_Paint({
        param($sender, $e)
        $g = $e.Graphics
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
        $g.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::ClearTypeGridFit

        $rect = New-Object System.Drawing.Rectangle(0, 0, ($sender.Width - 1), ($sender.Height - 1))
        $radius = $sender.Height  # Full height radius for pill shape

        # Build rounded rectangle path (pill shape)
        $path = New-Object System.Drawing.Drawing2D.GraphicsPath
        $path.AddArc($rect.X, $rect.Y, $radius, $radius, 180, 90)
        $path.AddArc(($rect.Right - $radius), $rect.Y, $radius, $radius, 270, 90)
        $path.AddArc(($rect.Right - $radius), ($rect.Bottom - $radius), $radius, $radius, 0, 90)
        $path.AddArc($rect.X, ($rect.Bottom - $radius), $radius, $radius, 90, 90)
        $path.CloseFigure()

        # Fill background
        $brush = New-Object System.Drawing.SolidBrush($badgeBackColor)
        $g.FillPath($brush, $path)
        $brush.Dispose()

        # Draw centered text
        $textBrush = New-Object System.Drawing.SolidBrush($badgeForeColor)
        $sf = New-Object System.Drawing.StringFormat
        $sf.Alignment = [System.Drawing.StringAlignment]::Center
        $sf.LineAlignment = [System.Drawing.StringAlignment]::Center
        $textRect = New-Object System.Drawing.RectangleF(0, 0, $sender.Width, $sender.Height)
        $g.DrawString($sender.Tag, $badgeFont, $textBrush, $textRect, $sf)
        $textBrush.Dispose()
        $sf.Dispose()
        $path.Dispose()
    }.GetNewClosure())

    # Store the display text in Tag for the paint handler to read
    $badge.Tag = $Text

    return $badge
}

function New-StyledDataGridView {
    <#
    .SYNOPSIS
        Creates a themed DataGridView with consistent styling for tabular data.
        Includes alternating row colors, proper column sizing, row hover highlight,
        comfortable row height, and read-only mode by default.
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
    $dgv.ReadOnly = $true
    $dgv.RowTemplate.Height = 30
    $dgv.ColumnHeadersHeight = 34
    $dgv.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right -bor [System.Windows.Forms.AnchorStyles]::Bottom

    # Default cell style
    $dgv.DefaultCellStyle.BackColor = $script:Theme.Surface
    $dgv.DefaultCellStyle.ForeColor = $script:Theme.Text
    $dgv.DefaultCellStyle.SelectionBackColor = $script:Theme.Primary
    $dgv.DefaultCellStyle.SelectionForeColor = [System.Drawing.Color]::White
    $dgv.DefaultCellStyle.Padding = New-Object System.Windows.Forms.Padding(4, 2, 4, 2)

    # Column header style - use primary-dark shade for a strong header
    $dgv.ColumnHeadersDefaultCellStyle.BackColor = $script:Theme.PrimaryDark
    $dgv.ColumnHeadersDefaultCellStyle.ForeColor = [System.Drawing.Color]::White
    $dgv.ColumnHeadersDefaultCellStyle.Font = New-Object System.Drawing.Font('Segoe UI', 9.5, [System.Drawing.FontStyle]::Bold)
    $dgv.ColumnHeadersDefaultCellStyle.SelectionBackColor = $script:Theme.PrimaryDark
    $dgv.ColumnHeadersDefaultCellStyle.SelectionForeColor = [System.Drawing.Color]::White
    $dgv.ColumnHeadersDefaultCellStyle.Padding = New-Object System.Windows.Forms.Padding(4, 2, 4, 2)

    # Alternating row style for better readability
    $dgv.AlternatingRowsDefaultCellStyle.BackColor = $script:Theme.CardBackground

    # Row hover highlight effect using CellMouseEnter / CellMouseLeave
    $dgv.Add_CellMouseEnter({
        param($sender, $e)
        if ($e.RowIndex -ge 0) {
            $sender.Rows[$e.RowIndex].DefaultCellStyle.BackColor = $script:Theme.SurfaceLight
        }
    })
    $dgv.Add_CellMouseLeave({
        param($sender, $e)
        if ($e.RowIndex -ge 0) {
            # Restore the correct color based on whether this is an alternating row
            if ($e.RowIndex % 2 -eq 1) {
                $sender.Rows[$e.RowIndex].DefaultCellStyle.BackColor = $script:Theme.CardBackground
            } else {
                $sender.Rows[$e.RowIndex].DefaultCellStyle.BackColor = $script:Theme.Surface
            }
        }
    })

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
    $scrollPanel.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right -bor [System.Windows.Forms.AnchorStyles]::Bottom

    return $scrollPanel
}

function New-StyledProgressBar {
    <#
    .SYNOPSIS
        Creates a themed progress bar for operations like network scanning and
        profile deployment. Uses custom painting to match the application theme.
    .PARAMETER X
        Horizontal position.
    .PARAMETER Y
        Vertical position.
    .PARAMETER Width
        Width of the progress bar. Default 400.
    .PARAMETER Height
        Height of the progress bar. Default 20.
    .EXAMPLE
        $progressBar = New-StyledProgressBar -X 20 -Y 100 -Width 500 -Height 24
        $progressBar.Value = 50  # Set to 50%
    #>
    param(
        [int]$X = 0,
        [int]$Y = 0,
        [int]$Width = 400,
        [int]$Height = 20
    )

    $progressBar = New-Object System.Windows.Forms.ProgressBar
    $progressBar.Location = New-Object System.Drawing.Point($X, $Y)
    $progressBar.Size = New-Object System.Drawing.Size($Width, $Height)
    $progressBar.Minimum = 0
    $progressBar.Maximum = 100
    $progressBar.Value = 0
    $progressBar.Style = [System.Windows.Forms.ProgressBarStyle]::Continuous
    $progressBar.Anchor = [System.Windows.Forms.AnchorStyles]::Top -bor [System.Windows.Forms.AnchorStyles]::Left -bor [System.Windows.Forms.AnchorStyles]::Right

    # Use SetStyle to enable custom painting for theme colors
    # The ProgressBar control does not natively support BackColor/ForeColor well on
    # all Windows themes, so we use the WinForms workaround of setting the ForeColor
    # and enabling visual-style override.
    $progressBar.SetStyle([System.Windows.Forms.ControlStyles]::UserPaint, $true)
    $progressBar.SetStyle([System.Windows.Forms.ControlStyles]::OptimizedDoubleBuffer, $true)

    # Custom paint to draw a themed progress bar with rounded ends
    $progressBar.Add_Paint({
        param($sender, $e)
        $g = $e.Graphics
        $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias

        $barRect = New-Object System.Drawing.Rectangle(0, 0, ($sender.Width - 1), ($sender.Height - 1))
        $radius = [Math]::Min(6, [int]($sender.Height / 2))

        # Draw track background (rounded rectangle)
        $trackPath = New-Object System.Drawing.Drawing2D.GraphicsPath
        $trackPath.AddArc($barRect.X, $barRect.Y, $radius * 2, $radius * 2, 180, 90)
        $trackPath.AddArc(($barRect.Right - $radius * 2), $barRect.Y, $radius * 2, $radius * 2, 270, 90)
        $trackPath.AddArc(($barRect.Right - $radius * 2), ($barRect.Bottom - $radius * 2), $radius * 2, $radius * 2, 0, 90)
        $trackPath.AddArc($barRect.X, ($barRect.Bottom - $radius * 2), $radius * 2, $radius * 2, 90, 90)
        $trackPath.CloseFigure()

        $trackBrush = New-Object System.Drawing.SolidBrush($script:Theme.Surface)
        $g.FillPath($trackBrush, $trackPath)
        $trackBrush.Dispose()

        # Draw the filled portion if progress > 0
        if ($sender.Value -gt 0) {
            $fraction = $sender.Value / $sender.Maximum
            $fillWidth = [Math]::Max(($radius * 2), [int]($barRect.Width * $fraction))
            $fillRect = New-Object System.Drawing.Rectangle(0, 0, $fillWidth, ($sender.Height - 1))

            $fillPath = New-Object System.Drawing.Drawing2D.GraphicsPath
            $fillPath.AddArc($fillRect.X, $fillRect.Y, $radius * 2, $radius * 2, 180, 90)
            $fillPath.AddArc(($fillRect.Right - $radius * 2), $fillRect.Y, $radius * 2, $radius * 2, 270, 90)
            $fillPath.AddArc(($fillRect.Right - $radius * 2), ($fillRect.Bottom - $radius * 2), $radius * 2, $radius * 2, 0, 90)
            $fillPath.AddArc($fillRect.X, ($fillRect.Bottom - $radius * 2), $radius * 2, $radius * 2, 90, 90)
            $fillPath.CloseFigure()

            # Gradient fill from Primary to PrimaryLight
            $fillBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
                $fillRect,
                $script:Theme.Primary,
                $script:Theme.PrimaryLight,
                [System.Drawing.Drawing2D.LinearGradientMode]::Horizontal
            )
            $g.FillPath($fillBrush, $fillPath)
            $fillBrush.Dispose()
            $fillPath.Dispose()
        }

        # Draw subtle border around the track
        $borderPen = New-Object System.Drawing.Pen($script:Theme.Border, 1)
        $g.DrawPath($borderPen, $trackPath)
        $borderPen.Dispose()
        $trackPath.Dispose()
    })

    return $progressBar
}
