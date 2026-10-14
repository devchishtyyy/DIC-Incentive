<#
.SYNOPSIS
    Fetches the employee roster from SAP SuccessFactors and saves it for the import screen.

.DESCRIPTION
    Runs the full OAuth2 SAML Bearer Assertion flow, then pages through the OData User
    entity and writes the result to a JSON file.

        1. POST /oauth/idp    — sign a SAML assertion with the registered private key
        2. POST /oauth/token  — exchange the assertion for an access token (valid 24h)
        3. GET  /odata/v2/User — page through the roster

    The assertion is valid for ten minutes and the token for a day, so this is run fresh
    each time rather than storing either. The private key is read from an environment
    variable and is never written to disk by this script.

.EXAMPLE
    # Set the key once per terminal session (it is not stored anywhere):
    $env:SF_PRIVATE_KEY = '<the private_key value from the Postman environment>'

    .\tools\fetch-sap-users.ps1

.EXAMPLE
    # A different Emp ID range, and keep every field SuccessFactors returns:
    .\tools\fetch-sap-users.ps1 -FromUserId '40010000' -ToUserId '40019999'
#>

[CmdletBinding()]
param(
    [string] $ApiServer  = 'https://api44.sapsf.com',
    [string] $ClientId   = 'NmEwYWE4MDJmYmVlMjg2NGVhNzhjYzcwOWY2OA',
    [string] $CompanyId  = 'packagesli',
    [string] $UserId     = 'ECAdmin',
    [string] $FromUserId = '40000000',
    [string] $ToUserId   = '40009999',
    [string] $OutFile    = 'sap-users.json',
    # Limit the columns SuccessFactors returns. Leave empty to get everything, which is
    # useful the first time so the import screen can show you what is available.
    [string] $Select     = ''
)

$ErrorActionPreference = 'Stop'

# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

$privateKey = $env:SF_PRIVATE_KEY
if ([string]::IsNullOrWhiteSpace($privateKey)) {
    Write-Host ''
    Write-Host 'SF_PRIVATE_KEY is not set.' -ForegroundColor Red
    Write-Host 'Set it for this terminal session only:' -ForegroundColor Yellow
    Write-Host '    $env:SF_PRIVATE_KEY = ''<private_key value>''' -ForegroundColor Yellow
    Write-Host ''
    Write-Host 'Do not paste the key into a file, a chat window, or anything that gets committed.' -ForegroundColor Yellow
    exit 1
}

function Show-HttpError {
    param($Err, [string] $Step)
    Write-Host ''
    Write-Host "$Step failed." -ForegroundColor Red
    $response = $Err.Exception.Response
    if ($response) {
        try {
            $reader = New-Object System.IO.StreamReader($response.GetResponseStream())
            $body = $reader.ReadToEnd()
            $reader.Close()
            if ($body) { Write-Host $body -ForegroundColor DarkGray }
        } catch {
            Write-Host $Err.Exception.Message -ForegroundColor DarkGray
        }
    } else {
        Write-Host $Err.Exception.Message -ForegroundColor DarkGray
    }
    exit 1
}

# ---------------------------------------------------------------------------
# 1. Sign a SAML assertion
# ---------------------------------------------------------------------------

Write-Host '1/3  Requesting a SAML assertion...' -NoNewline

$tokenUrl = "$ApiServer/oauth/token"
try {
    $assertion = Invoke-RestMethod -Method Post -Uri "$ApiServer/oauth/idp" `
        -ContentType 'application/x-www-form-urlencoded' `
        -Body @{
            client_id   = $ClientId
            user_id     = $UserId
            token_url   = $tokenUrl
            private_key = $privateKey
        }
} catch {
    Show-HttpError $_ '  SAML assertion'
}

$assertion = ($assertion | Out-String).Trim()
if ([string]::IsNullOrWhiteSpace($assertion)) {
    Write-Host ' no assertion returned.' -ForegroundColor Red
    exit 1
}
Write-Host ' ok' -ForegroundColor Green

# ---------------------------------------------------------------------------
# 2. Exchange it for an access token
# ---------------------------------------------------------------------------

Write-Host '2/3  Exchanging it for an access token...' -NoNewline

try {
    $tokenResponse = Invoke-RestMethod -Method Post -Uri $tokenUrl `
        -ContentType 'application/x-www-form-urlencoded' `
        -Body @{
            client_id  = $ClientId
            company_id = $CompanyId
            grant_type = 'urn:ietf:params:oauth:grant-type:saml2-bearer'
            assertion  = $assertion
        }
} catch {
    Show-HttpError $_ '  Token exchange'
}

$accessToken = $tokenResponse.access_token
if ([string]::IsNullOrWhiteSpace($accessToken)) {
    Write-Host ' no access_token in the response.' -ForegroundColor Red
    exit 1
}
Write-Host ' ok' -ForegroundColor Green

# ---------------------------------------------------------------------------
# 3. Page through the User entity
# ---------------------------------------------------------------------------

Write-Host '3/3  Fetching users...' -NoNewline

$filter = "userId ge '$FromUserId' and userId le '$ToUserId' and status eq 't'"
$query = '$filter=' + [uri]::EscapeDataString($filter) + '&$format=json'
if (-not [string]::IsNullOrWhiteSpace($Select)) {
    $query += '&$select=' + [uri]::EscapeDataString($Select)
}

$url = "$ApiServer/odata/v2/User?$query"
$headers = @{ Authorization = "Bearer $accessToken" }
$all = New-Object System.Collections.ArrayList
$page = 0

while ($url) {
    try {
        $response = Invoke-RestMethod -Method Get -Uri $url -Headers $headers
    } catch {
        Write-Host ''
        Show-HttpError $_ '  User fetch'
    }

    if ($response.d -and $response.d.results) {
        foreach ($row in $response.d.results) { [void]$all.Add($row) }
    }

    $page++
    Write-Host ".$($all.Count)" -NoNewline

    # OData v2 hands back the next page in __next until there are no more.
    $url = $null
    if ($response.d -and $response.d.PSObject.Properties.Name -contains '__next') {
        $url = $response.d.__next
    }
}

Write-Host ''

if ($all.Count -eq 0) {
    Write-Host "No users matched userId between '$FromUserId' and '$ToUserId' with status 't'." -ForegroundColor Yellow
    exit 0
}

# Written in the same envelope the API uses, so the import screen reads it unchanged.
$payload = [ordered]@{ d = [ordered]@{ results = $all.ToArray() } }
$json = $payload | ConvertTo-Json -Depth 12
[System.IO.File]::WriteAllText((Join-Path (Get-Location) $OutFile), $json, (New-Object System.Text.UTF8Encoding($false)))

$fields = ($all[0].PSObject.Properties.Name | Where-Object { $_ -ne '__metadata' })

Write-Host ''
Write-Host "Saved $($all.Count) users to $OutFile" -ForegroundColor Green
Write-Host "$($fields.Count) fields per record, $page page(s)."
Write-Host ''
Write-Host 'This file contains live staff data. It is gitignored — keep it that way.' -ForegroundColor Yellow
Write-Host ''
Write-Host 'Next: npm run dev, sign in as Sana Mirza (Admin), Master Data -> Import from SAP,' -ForegroundColor Cyan
Write-Host "      and drop $OutFile onto the page." -ForegroundColor Cyan
