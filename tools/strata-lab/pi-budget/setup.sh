#!/bin/sh
# Fetches the calibration tools into a scratch folder (not into the repository).
#   sh tools/strata-lab/pi-budget/setup.sh /tmp/pi-budget-tools
# - p7zip 16.02 (x86-64 build from the Ubuntu archive): the 7-Zip version sbc-bench runs on Raspberry Pi OS
# - CoreMark (github.com/eembc/coremark), built with gcc -O2, one thread
# - Speedometer 2.1 and 3.0 (github.com/WebKit/Speedometer, branches release/2.1, release/3.0), JetStream 2.0 and 2.1
#   (github.com/WebKit/JetStream, branches JetStream2.0, JetStream2.1) and Octane 2.0 (github.com/chromium/octane)
# Optional system packages: sysbench and 7zip (7-Zip 23.01) for calibration, glslang-tools and spirv-tools
# (shader op counts).
set -e
D=${1:?usage: setup.sh TOOLS_DIR}
mkdir -p "$D"
cd "$D"
if [ ! -x p7zip/usr/lib/p7zip/7zr ]; then
  curl -sSfO http://archive.ubuntu.com/ubuntu/pool/universe/p/p7zip/p7zip_16.02+dfsg-8_amd64.deb
  dpkg -x p7zip_16.02+dfsg-8_amd64.deb p7zip
fi
[ -d coremark ] || git clone -q --depth 1 https://github.com/eembc/coremark
[ -x coremark/coremark.exe ] || (cd coremark && make -s PORT_DIR=linux XCFLAGS="-DMULTITHREAD=1 -DUSE_FORK" REBUILD=1 link >/dev/null)
[ -d speedometer21 ] || git clone -q --depth 1 -b release/2.1 https://github.com/WebKit/Speedometer speedometer21
[ -d speedometer30 ] || git clone -q --depth 1 -b release/3.0 https://github.com/WebKit/Speedometer speedometer30
[ -d jetstream20 ] || git clone -q --depth 1 -b JetStream2.0 https://github.com/WebKit/JetStream jetstream20
[ -d jetstream21 ] || git clone -q --depth 1 -b JetStream2.1 https://github.com/WebKit/JetStream jetstream21
[ -d octane ] || git clone -q --depth 1 https://github.com/chromium/octane octane
for t in sysbench 7z glslangValidator spirv-opt spirv-dis; do
  command -v $t >/dev/null || echo "optional: $t not found (apt-get install sysbench 7zip glslang-tools spirv-tools)"
done
echo "tools ready in $D"
