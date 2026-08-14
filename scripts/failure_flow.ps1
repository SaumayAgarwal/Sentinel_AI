Write-Host "--- Simulating payment-service failure ---"
$failureBody = '{"service":"payment-service","mode":"DOWN"}'
$failureResponse = Invoke-RestMethod -Method POST -Uri http://localhost:3009/api/admin/failure -Body $failureBody -Headers @{"Content-Type"="application/json"}
Write-Host "Failure response: $($failureResponse.message) mode $($failureResponse.failureState.mode)"
Start-Sleep -Seconds 6

Write-Host "--- Checking incident creation ---"
$incidents = Invoke-RestMethod -Uri http://localhost:3006/incidents
$latest = $incidents.incidents | Where-Object { $_.serviceName -eq 'payment-service' -and $_.status -eq 'OPEN' } | Select-Object -First 1
if ($latest) {
  Write-Host "Incident created: ID $($latest.id) Status $($latest.status)"
} else {
  Write-Host "No incident yet"
}

Write-Host "--- Triggering recovery ---"
$recBody = '{"service":"payment-service"}'
$recResponse = Invoke-RestMethod -Method POST -Uri http://localhost:3009/api/admin/recovery -Body $recBody -Headers @{"Content-Type"="application/json"}
Write-Host "Recovery response: $($recResponse.message) mode $($recResponse.failureState.mode)"
Start-Sleep -Seconds 4

Write-Host "--- Payment service health after recovery ---"
$payHealth = Invoke-RestMethod -Uri http://localhost:3003/health
Write-Host "Payment service health: $($payHealth.status) ($($payHealth.mode))"
