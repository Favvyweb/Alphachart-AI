# Enhanced PowerShell HTTP Server for AlphaChart AI
$port = 8080
if ([string]::IsNullOrWhiteSpace($PSScriptRoot)) {
    $root = (Get-Location).Path
}
else {
    $root = (Get-Item $PSScriptRoot).FullName
}

$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")

try {
    $listener.Start()
}
catch {
    Write-Error "Failed to start listener on port $port. Check if port is already in use or run as administrator."
    exit 1
}

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " AlphaChart AI Server Running" -ForegroundColor Green
Write-Host " Local URL: http://localhost:$port/" -ForegroundColor Yellow
Write-Host " Root Directory: $root" -ForegroundColor Gray
Write-Host " Press Ctrl+C in terminal to stop" -ForegroundColor Gray
Write-Host "==========================================" -ForegroundColor Cyan

$mimeTypes = @{
    ".html"  = "text/html; charset=utf-8"
    ".css"   = "text/css; charset=utf-8"
    ".js"    = "application/javascript; charset=utf-8"
    ".mjs"   = "application/javascript; charset=utf-8"
    ".json"  = "application/json; charset=utf-8"
    ".svg"   = "image/svg+xml"
    ".png"   = "image/png"
    ".jpg"   = "image/jpeg"
    ".jpeg"  = "image/jpeg"
    ".gif"   = "image/gif"
    ".webp"  = "image/webp"
    ".ico"   = "image/x-icon"
    ".woff"  = "font/woff"
    ".woff2" = "font/woff2"
    ".ttf"   = "font/ttf"
}

while ($listener.IsListening) {
    try {
        $context = $listener.GetContext()
        $request = $context.Request
        $response = $context.Response

        # Add CORS Headers
        $response.AddHeader("Access-Control-Allow-Origin", "*")
        $response.AddHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        $response.AddHeader("Access-Control-Allow-Headers", "Content-Type, Authorization")

        # Handle CORS Preflight
        if ($request.HttpMethod -eq "OPTIONS") {
            $response.StatusCode = 204
            $response.OutputStream.Close()
            continue
        }

        $rawPath = [System.Uri]::UnescapeDataString($request.Url.LocalPath)
        if ($rawPath -eq "/" -or [string]::IsNullOrWhiteSpace($rawPath)) {
            $rawPath = "/index.html"
        }

        # ========================================================
        # API ROUTE: /api/auth/sync (PostgreSQL / Local Sync)
        # ========================================================
        if ($rawPath -eq "/api/auth/sync" -and $request.HttpMethod -eq "POST") {
            $encoding = if ($request.ContentEncoding) { $request.ContentEncoding } else { [System.Text.Encoding]::UTF8 }
            $reader = New-Object System.IO.StreamReader($request.InputStream, $encoding)
            $bodyText = $reader.ReadToEnd()
            $reader.Close()

            $dbDir = Join-Path $root "database"
            if (-not (Test-Path $dbDir)) { New-Item -ItemType Directory -Path $dbDir | Out-Null }
            $localDbPath = Join-Path $dbDir "local_users.json"

            $usersList = @()
            if (Test-Path $localDbPath) {
                try {
                    $jsonContent = Get-Content $localDbPath -Raw
                    if (-not [string]::IsNullOrWhiteSpace($jsonContent)) {
                        $usersList = @($jsonContent | ConvertFrom-Json)
                    }
                } catch {}
            }

            $newUser = $null
            try {
                $newUser = $bodyText | ConvertFrom-Json
            } catch {}

            if ($newUser -and $newUser.email) {
                $cleanEmail = $newUser.email.ToLower().Trim()
                $existing = $usersList | Where-Object { $_.email -eq $cleanEmail }
                if ($existing) {
                    $existing.login_count = ($existing.login_count + 1)
                    $existing.last_login_at = (Get-Date).ToString("o")
                    $existing.device_platform = $newUser.device_platform
                    $existing.pwa_installed = $newUser.pwa_installed
                } else {
                    $record = [PSCustomObject]@{
                        id = [System.Guid]::NewGuid().ToString()
                        email = $cleanEmail
                        display_name = $newUser.display_name
                        subscription_tier = "PRO_TRIAL"
                        device_platform = $newUser.device_platform
                        pwa_installed = $newUser.pwa_installed
                        login_count = 1
                        created_at = (Get-Date).ToString("o")
                        last_login_at = (Get-Date).ToString("o")
                    }
                    $usersList += $record
                }
                $usersList | ConvertTo-Json -Depth 5 | Set-Content $localDbPath
            }

            $response.ContentType = "application/json; charset=utf-8"
            $response.StatusCode = 200
            $resJson = @{
                success = $true
                message = "User captured in AlphaChart backend (PostgreSQL Ready)"
                email = if ($newUser) { $newUser.email } else { $null }
            } | ConvertTo-Json
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($resJson)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.OutputStream.Close()
            continue
        }

        # ========================================================
        # API ROUTE: /api/users (Subscribers List / Marketing Export)
        # ========================================================
        if ($rawPath -eq "/api/users") {
            $localDbPath = Join-Path $root "database\local_users.json"
            $usersList = @()
            if (Test-Path $localDbPath) {
                try {
                    $jsonContent = Get-Content $localDbPath -Raw
                    if (-not [string]::IsNullOrWhiteSpace($jsonContent)) {
                        $usersList = @($jsonContent | ConvertFrom-Json)
                    }
                } catch {}
            }

            $response.ContentType = "application/json; charset=utf-8"
            $response.StatusCode = 200
            $resJson = @{
                success = $true
                count = $usersList.Count
                subscribers = $usersList
            } | ConvertTo-Json -Depth 5
            $bytes = [System.Text.Encoding]::UTF8.GetBytes($resJson)
            $response.ContentLength64 = $bytes.Length
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
            $response.OutputStream.Close()
            continue
        }

        # Safe Path Resolution (Protects against path traversal attacks)
        $cleanRelPath = $rawPath.TrimStart('/').Replace('/', [System.IO.Path]::DirectorySeparatorChar)
        $localPath = [System.IO.Path]::GetFullPath((Join-Path $root $cleanRelPath))

        if (-not $localPath.StartsWith($root, [System.StringComparison]::OrdinalIgnoreCase)) {
            # Forbidden: attempted path traversal
            $response.StatusCode = 403
            $forbiddenMsg = [System.Text.Encoding]::UTF8.GetBytes("403 Forbidden")
            $response.OutputStream.Write($forbiddenMsg, 0, $forbiddenMsg.Length)
        }
        elseif (Test-Path $localPath -PathType Leaf) {
            $ext = [System.IO.Path]::GetExtension($localPath).ToLower()
            if ($mimeTypes.ContainsKey($ext)) {
                $response.ContentType = $mimeTypes[$ext]
            }
            else {
                $response.ContentType = "application/octet-stream"
            }

            $content = [System.IO.File]::ReadAllBytes($localPath)
            $response.ContentLength64 = $content.Length
            $response.StatusCode = 200
            $response.OutputStream.Write($content, 0, $content.Length)
        }
        else {
            $response.StatusCode = 404
            $notFound = [System.Text.Encoding]::UTF8.GetBytes("404 Not Found")
            $response.OutputStream.Write($notFound, 0, $notFound.Length)
        }

        $response.OutputStream.Close()
    }
    catch {
        Write-Warning "Request handling error: $_"
        try { $response.OutputStream.Close() } catch {}
    }
}
