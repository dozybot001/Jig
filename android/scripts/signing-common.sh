# Shared by backup-signing-key.sh and release.sh. Sourced, not run.
# Neither script prints the keystore password or passes it as a command argument: it goes from the
# login keychain into an environment variable of the one tool that needs it.

KEY_DIR="$HOME/.tenon-keys/android/yew"
KEYSTORE_NAME="yew-release.p12"
KEYSTORE="$KEY_DIR/$KEYSTORE_NAME"
KEY_ALIAS="yew"
KEYCHAIN_SERVICE="tenon-android-signing"
KEYCHAIN_ACCOUNT="yew"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ANDROID_DIR="$(dirname "$SCRIPT_DIR")"
# The certificate's SHA-256 fingerprint, written when the key was created. It is public, and the
# backup and every release are checked against it.
FINGERPRINT_FILE="$ANDROID_DIR/release/signing-certificate.sha256"

export JAVA_HOME="${JAVA_HOME:-$(/usr/libexec/java_home -v 21)}"
KEYTOOL="$JAVA_HOME/bin/keytool"
SDK_DIR="${ANDROID_HOME:-$HOME/Library/Android/sdk}"
BUILD_TOOLS="$SDK_DIR/build-tools/37.0.0"

fail() {
    echo "错误：$*" >&2
    exit 1
}

# Puts the keystore password into YEW_KS_PASS for the commands that follow in this shell.
load_keystore_password() {
    YEW_KS_PASS="$(security find-generic-password -s "$KEYCHAIN_SERVICE" -a "$KEYCHAIN_ACCOUNT" -w 2>/dev/null)" ||
        fail "钥匙串里没有签名密钥的口令（服务 ${KEYCHAIN_SERVICE}，账户 ${KEYCHAIN_ACCOUNT}）"
    export YEW_KS_PASS
}

# Prints the certificate in a keystore, as PEM. Needs YEW_KS_PASS.
certificate_of() { # <keystore>
    "$KEYTOOL" -exportcert -rfc -keystore "$1" -storetype PKCS12 -alias "$KEY_ALIAS" -storepass:env YEW_KS_PASS
}

# Reads a PEM certificate on standard input and prints one fingerprint, upper-case hex without colons.
fingerprint() { # sha256 | sha1 | md5
    openssl x509 -noout -fingerprint "-$1" | sed -e 's/^.*=//' -e 's/://g'
}
