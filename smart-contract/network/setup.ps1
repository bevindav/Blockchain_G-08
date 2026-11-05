$ErrorActionPreference = 'Stop'
$networkPath = $PSScriptRoot
$generatedPath = Join-Path $networkPath 'generated'
$image = 'hyperledger/besu:24.12.0'
if (Test-Path -LiteralPath $generatedPath) {
    throw 'generated already exists. Reuse its compose.yaml to preserve validator identities and chain data.'
}
docker run --rm --mount "type=bind,source=$networkPath,target=/network" $image operator generate-blockchain-config --config-file=/network/qbft-config.json --to=/network/generated --private-key-file-name=key
if ($LASTEXITCODE -ne 0) { throw 'Besu configuration generation failed' }
$keys = @(Get-ChildItem -LiteralPath (Join-Path $generatedPath 'keys') -Directory | Sort-Object Name)
if ($keys.Count -ne 4) { throw 'Expected four validator keys' }
$services = [ordered]@{}
for ($index = 0; $index -lt 4; $index++) {
    $nodeName = 'validator' + ($index + 1)
    $nodePath = Join-Path $generatedPath $nodeName
    New-Item -ItemType Directory -Path $nodePath | Out-Null
    Copy-Item -LiteralPath (Join-Path $keys[$index].FullName 'key') -Destination (Join-Path $nodePath 'key')
}
$bootPublicKey = (Get-Content -LiteralPath (Join-Path $keys[0].FullName 'key.pub') -Raw).Trim() -replace '^0x', ''
for ($index = 0; $index -lt 4; $index++) {
    $nodeName = 'validator' + ($index + 1)
    $command = @('--data-path=/data', '--genesis-file=/network/genesis.json', '--network-id=1337',
        '--min-gas-price=0', '--host-allowlist=*', ('--p2p-host=' + $nodeName))
    if ($index -gt 0) { $command += "--bootnodes=enode://${bootPublicKey}@validator1:30303" }
    if ($index -eq 0) { $command += @('--rpc-http-enabled', '--rpc-http-host=0.0.0.0', '--rpc-http-api=ETH,NET,WEB3,QBFT') }
    $service = [ordered]@{
        image = $image
        command = $command
        volumes = @('./genesis.json:/network/genesis.json:ro', "./${nodeName}:/data")
    }
    if ($index -eq 0) { $service.ports = @('127.0.0.1:8545:8545') }
    $services[$nodeName] = $service
}
# JSON is valid YAML, so Docker Compose can read this without a YAML dependency.
$compose = @{ services = $services } | ConvertTo-Json -Depth 8
[IO.File]::WriteAllText((Join-Path $generatedPath 'compose.yaml'), $compose)
Write-Host 'Generated. Start with: docker compose -f smart-contract/network/generated/compose.yaml up -d'
