# Nederlandse voice-over met de Windows-stem "Microsoft Frank" (WinRT, offline).
# Elke regel een eigen WAV in .\voice\NN.wav, met de duur in voice\durations.json.
$ErrorActionPreference = "Stop"
$out = Join-Path $PSScriptRoot "voice"
New-Item -ItemType Directory -Force $out | Out-Null

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object {
  $_.Name -eq "AsTask" -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($op, [type]$type) {
  $task = $asTask.MakeGenericMethod($type).Invoke($null, @($op))
  $task.Wait() | Out-Null
  $task.Result
}

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$voice = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -like "*Frank*" } | Select-Object -First 1
if (-not $voice) { throw "Stem Frank niet gevonden" }
$synth.Voice = $voice

$lines = Get-Content (Join-Path $PSScriptRoot "script.txt") -Encoding UTF8 | Where-Object { $_.Trim() }
$durations = @()
$i = 0
foreach ($line in $lines) {
  $i++
  $text = [System.Security.SecurityElement]::Escape($line.Trim())
  $ssml = "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='nl-NL'><prosody rate='0.95' pitch='-2%'>$text</prosody></speak>"
  $stream = Await ($synth.SynthesizeSsmlToStreamAsync($ssml)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  $size = [uint32]$stream.Size
  $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
  $null = Await ($reader.LoadAsync($size)) ([uint32])
  $bytes = New-Object byte[] $size
  $reader.ReadBytes($bytes)
  $file = Join-Path $out ("{0:D2}.wav" -f $i)
  [System.IO.File]::WriteAllBytes($file, $bytes)
  # WAV-duur: data-grootte / byterate (byterate staat op offset 28).
  $byteRate = [BitConverter]::ToUInt32($bytes, 28)
  $durations += [math]::Round(($size - 44) / $byteRate, 2)
}
($durations | ConvertTo-Json) | Set-Content (Join-Path $out "durations.json") -Encoding UTF8
"regels: $i"
"duren (s): $($durations -join ', ')"
