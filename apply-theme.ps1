$file = "src/app/dashboard/dashboard.component.css"
$css = Get-Content $file -Raw

# Find end of variable block - look for the closing brace after --swatch-border in the dark theme section
$darkThemeStart = $css.IndexOf('[data-theme="dark"]')
$swatchLine = $css.IndexOf("--swatch-border:", $darkThemeStart)
$blockEnd = $css.IndexOf("}", $swatchLine) + 1

$varBlock = $css.Substring(0, $blockEnd)
$rest = $css.Substring($blockEnd)

# Background colors
$rest = $rest -replace '#f0f2f5', 'var(--bg-page)'
$rest = $rest -replace '#fafafa', 'var(--bg-surface-2)'
$rest = $rest -replace '#f5f3ff', 'var(--bg-hover)'
$rest = $rest -replace '#faf9ff', 'var(--bg-hover)'
$rest = $rest -replace '#ede9fe', 'var(--bg-selected)'

# Border colors
$rest = $rest -replace '#e8eaed', 'var(--border)'
$rest = $rest -replace '#e0e0e0', 'var(--border-input)'
$rest = $rest -replace '#f0f0f0', 'var(--border-subtle)'
$rest = $rest -replace '#f5f5f5', 'var(--border-subtle)'

# Text colors - only where used as color/background-color values
$rest = $rest -replace 'color:\s*#1a1a2e', 'color: var(--text-primary)'
$rest = $rest -replace 'border-color:\s*#1a1a2e', 'border-color: var(--swatch-border)'
$rest = $rest -replace 'color:\s*#666(?![0-9a-fA-F])', 'color: var(--text-secondary)'
$rest = $rest -replace 'color:\s*#444(?![0-9a-fA-F])', 'color: var(--text-secondary)'
$rest = $rest -replace 'color:\s*#888(?![0-9a-fA-F])', 'color: var(--text-muted)'
$rest = $rest -replace 'color:\s*#aaa(?![0-9a-fA-F])', 'color: var(--text-faint)'
$rest = $rest -replace 'color:\s*#bbb(?![0-9a-fA-F])', 'color: var(--text-faint)'
$rest = $rest -replace 'color:\s*#ccc(?![0-9a-fA-F])', 'color: var(--text-faint)'
$rest = $rest -replace 'color:\s*#333(?![0-9a-fA-F])', 'color: var(--text-primary)'
$rest = $rest -replace 'color:\s*#555(?![0-9a-fA-F])', 'color: var(--text-secondary)'
$rest = $rest -replace 'color:\s*#ddd(?![0-9a-fA-F])', 'color: var(--border-input)'

# Accent colors
$rest = $rest -replace '#6c63ff', 'var(--accent)'
$rest = $rest -replace '#a89cff', 'var(--accent-mid)'

# Error/success states
$rest = $rest -replace '#fff0f0', 'var(--error-bg)'
$rest = $rest -replace '#ffcdd2', 'var(--error-border)'
$rest = $rest -replace '#c62828', 'var(--error-text)'
$rest = $rest -replace '#f0fdf4', 'var(--success-bg)'
$rest = $rest -replace '#bbf7d0', 'var(--success-border)'
$rest = $rest -replace '#15803d', 'var(--success-text)'

# Surface whites - background: #fff or background: #ffffff
$rest = $rest -replace 'background:\s*#ffffff', 'background: var(--bg-surface)'
$rest = $rest -replace 'background:\s*#fff(?![0-9a-fA-F])', 'background: var(--bg-surface)'

# Write result
$result = $varBlock + $rest
Set-Content $file -Value $result -NoNewline
Write-Output "Done!"
