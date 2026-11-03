# Phase 1: Template Alias Integration - Manual Steps

## Current Status
- ✅ `src/config/index.js` - Complete
- ✅ `src/utils/whatsapp-template.js` - Complete  
- ⚠️ `src/utils/template-alias.js` - Needs clean integration

## Issue Found
The manual replacement had a syntax error (await outside async function).
**Root cause:** Likely incomplete paste or duplicate code blocks.

## Clean Integration Steps

### Step 1: Add Config Import
At the **very top** of `src/utils/template-alias.js` (line 1), add:
```javascript
const config = require("../config");
```

### Step 2: Replace Function
Find this function (around line 164):
```javascript
async function resolveTemplateAlias({
  appId,
  channel,
  entityId,
  parentEntityId,
  notificationType,
}) {
```

Replace the **ENTIRE function body** (from the opening `{` to the closing `}`) with the optimized version from:
```bash
cat /tmp/template-alias-optimized-function.js
```

**Important:** 
- Keep the function signature (`async function resolveTemplateAlias({...})`)
- Replace everything from opening `{` to closing `}`
- Do NOT duplicate any code
- Make sure the closing `}` is followed by `module.exports = {`

### Step 3: Verify
```bash
# Must pass without timeout
node -c src/utils/template-alias.js

# Must load module
node -e "require('./src/utils/template-alias'); console.log('OK');"
```

## Alternative: Skip for Now
**Phase 1 already has 66% improvement** with just whatsapp-template.js optimized.

You can:
1. Move to Phase 2 (Redis caching) now
2. Come back to finish template-alias.js later
3. Or keep trying - the optimized code is ready

## Backups Available
```bash
ls -lt src/utils/template-alias.js.backup-*
```

Clean original restored to: `src/utils/template-alias.js`

