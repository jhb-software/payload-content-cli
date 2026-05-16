# payload-content-cli demo — 30s highlight reel
# Run: vhs .claude/skills/demo-video/demo.tape

Output .claude/skills/demo-video/output/demo.gif
Output .claude/skills/demo-video/output/demo.mp4

Set Shell zsh
Set FontSize 18
Set Width 1200
Set Height 700
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms

# Wire up mock CLI
Hide
Type "alias payload-content='./.claude/skills/demo-video/mock-cli.sh'"
Enter
Sleep 300ms
Type "clear"
Enter
Sleep 300ms
Show

# Scene 1: Auth & Discovery
Type "payload-content me"
Enter
Sleep 1.5s

Type "payload-content discover"
Enter
Sleep 2.5s

# Scene 2: Query content
Type `payload-content find posts --limit 3 --select '{"title":true,"status":true}'`
Enter
Sleep 3s

# Scene 3: Inline update
Type `payload-content update posts 3 --data '{"status":"published"}'`
Enter
Sleep 3s

# Scene 4: Update via file
Type "payload-content update posts 1 --file ./updated-post.json"
Enter
Sleep 3s

# Scene 5: Bulk upload
Type `payload-content upload media --dir ./images --glob '*.webp'`
Enter
Sleep 4s

# Scene 6: Closing
Sleep 500ms
Type "# Built for AI agents. Works great for humans too."
Sleep 2s
Ctrl+C
Sleep 1s
