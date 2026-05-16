---
name: demo-video
description: Create or update demo videos for payload-content-cli using VHS. Generates GIF and MP4 from a scripted terminal recording with mock CLI output.
---

# Demo Video Generation

Create or update demo videos for the payload-content-cli project using VHS (charmbracelet/vhs).

## Steps

1. **Script first** — Before touching any files, write a human-readable script with scenes (command + expected output) and present it to the user for review. Do NOT generate video until the script is approved.

2. **Update mock CLI** — If the script includes commands not yet handled by `.claude/skills/demo-video/mock-cli.sh`, add cases for them. The mock matches on `$1` (command name) and flags to return realistic JSON output. This avoids needing a running Payload instance.

3. **Write the tape** — Edit `.claude/skills/demo-video/demo.tape`. VHS syntax rules:
   - `Type "text"` for regular strings
   - Use backtick strings for commands containing single quotes: `` Type `payload-content find posts --select '{"title":true}'` ``
   - **Escaped quotes (`\"`) do NOT work in VHS `Type`** — always use backticks instead
   - `Hide`/`Show` to hide setup commands (alias wiring, clear)
   - `Sleep Xs` for pauses between scenes
   - The tape must wire up the mock CLI via a hidden alias: `Type "alias payload-content='./.claude/skills/demo-video/mock-cli.sh'"`

4. **Generate** — Run `vhs .claude/skills/demo-video/demo.tape` from the project root. Output goes to `.claude/skills/demo-video/output/`.

5. **Preview** — Extract frames with ffmpeg to verify scenes look correct:
   ```
   ffmpeg -i .claude/skills/demo-video/output/demo.mp4 -vf "select=eq(n\,N)" -frames:v 1 -update 1 -y /tmp/frame.png
   ```
   Show frames to the user for approval.

## File structure

```
.claude/skills/demo-video/
  SKILL.md        # This skill file
  demo.tape       # VHS script — defines what gets typed and shown
  mock-cli.sh     # Mock CLI that simulates payload-content output
  output/
    demo.gif      # Generated GIF (good for README/GitHub embeds)
    demo.mp4      # Generated MP4 (good for Twitter/LinkedIn)
```

## VHS settings reference

```tape
Set Shell zsh
Set FontSize 18
Set Width 1200
Set Height 700
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 35ms
```

## Guidelines

- Target ~30s for social media clips.
- Keep scenes focused: one command + output per scene.
- Use `Sleep` values that give enough time to read output but don't drag.
- GIF is better for README/GitHub embeds. MP4 is better for Twitter/LinkedIn.
- To publish a GIF: `vhs publish .claude/skills/demo-video/output/demo.gif`
- Prerequisites: `vhs` (`brew install vhs`) and `ffmpeg`.
