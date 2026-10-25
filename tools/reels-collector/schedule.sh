# HookAI success-reels collector: connect to the server and run once a day at 03:30.
# Usage on the Mac mini: paste this file into Terminal after replacing __TOKEN__.
set -e
cd ~/hookai-collector
cat > config.json <<'EOF_CONFIG'
{ "server": "https://api.hookai.kr", "token": "__TOKEN__" }
EOF_CONFIG
chmod 600 config.json
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
