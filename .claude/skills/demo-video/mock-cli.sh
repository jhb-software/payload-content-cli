#!/bin/bash
# Mock payload-content CLI for demo video recording
# Simulates realistic output without a running Payload instance
# All args are joined so we can match substrings easily
ALL="$*"

case "$1" in
  me)
    echo "Authenticated as: api-keys/cli-agent"
    ;;
  discover)
    echo "Collections: posts, pages, categories, media, users, api-keys"
    echo "Globals: site-settings"
    echo "Plugin: installed (schema metadata available)"
    ;;
  find)
    cat <<'EOF'
{
  "docs": [
    { "id": "1", "title": "Hello World", "status": "published" },
    { "id": "2", "title": "Getting Started with Payload CMS", "status": "published" },
    { "id": "3", "title": "Draft Post", "status": "draft" }
  ],
  "totalDocs": 5
}
EOF
    ;;
  update)
    if [[ "$ALL" == *"--file"* ]]; then
      cat <<'EOF'
{
  "id": "1",
  "title": "Hello World — Updated",
  "status": "published",
  "updatedAt": "2026-04-05T14:31:00.000Z"
}
EOF
    else
      cat <<'EOF'
{
  "id": "3",
  "title": "Draft Post",
  "status": "published",
  "updatedAt": "2026-04-05T14:30:00.000Z"
}
EOF
    fi
    ;;
  upload)
    echo "Uploading 4 files to media..."
    sleep 0.3; echo "  ✓ hero.webp"
    sleep 0.2; echo "  ✓ team-photo.webp"
    sleep 0.2; echo "  ✓ blog-cover.webp"
    sleep 0.3; echo "  ✓ product-shot.webp"
    echo ""
    echo "Done. 4 uploaded, 0 errors."
    ;;
esac
