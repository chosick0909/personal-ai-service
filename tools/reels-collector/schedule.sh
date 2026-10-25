# HookAI success-reels collector: create this Mac's own key, connect to the server,
# and run once a day at 03:30. The key never leaves this Mac; only its SHA-256 is shared.
set -e
cd ~/hookai-collector
if [ ! -f config.json ]; then
  TOKEN="$(openssl rand -base64 48 | tr '+/' '-_' | tr -d '=\n')"
  printf '{ "server": "https://api.hookai.kr", "token": "%s" }\n' "$TOKEN" > config.json
  chmod 600 config.json
fi
NODE_BIN="$(command -v node)"
mkdir -p ~/Library/LaunchAgents logs
cat > ~/Library/LaunchAgents/kr.hookai.collector.plist <<EOF_PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>kr.hookai.collector</string>
<key>ProgramArguments</key><array>
<string>${NODE_BIN}</string><string>${HOME}/hookai-collector/collector.mjs</string><string>collect</string>
</array>
<key>WorkingDirectory</key><string>${HOME}/hookai-collector</string>
<key>StartCalendarInterval</key><dict><key>Hour</key><integer>3</integer><key>Minute</key><integer>30</integer></dict>
<key>StandardOutPath</key><string>${HOME}/hookai-collector/logs/launchd.log</string>
<key>StandardErrorPath</key><string>${HOME}/hookai-collector/logs/launchd.log</string>
</dict></plist>
EOF_PLIST
launchctl bootout gui/$(id -u)/kr.hookai.collector 2>/dev/null || true
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/kr.hookai.collector.plist
echo "✅ 매일 03:30 자동 수집 등록 완료"
echo "아래 해시값을 복사해서 Claude에게 보내주세요 (열쇠 자체가 아니라 확인용 값입니다):"
node -e "const t=JSON.parse(require('fs').readFileSync('config.json','utf8')).token; console.log(require('crypto').createHash('sha256').update(t).digest('hex'))"
