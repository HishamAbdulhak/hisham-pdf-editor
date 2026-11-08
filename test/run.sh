#!/bin/sh
# Usage: sh test/run.sh test/t1-core.js   (runs the script inside the real app; exits 1 on failure)
cd "$(dirname "$0")/.."
[ -z "$KEEP" ] && rm -rf test/out/userdata
mkdir -p test/out
cat test/lib.js "$1" > test/out/_combined.js
PDFE_TEST="test/out/_combined.js" PDFE_TEST_OUT="test/out" timeout 300 node_modules/electron/dist/electron.exe . 2>&1 | grep -v "GPU\|gpu_\|DevTools\|Autofill" > test/out/_last.log
cat test/out/_last.log
grep -q "TEST RESULT" test/out/_last.log && ! grep -q "TEST ERROR" test/out/_last.log
