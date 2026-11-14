// Writes the fixed vectors the Android unit tests check (app/src/test/resources/noise-vectors.json)
// from the computer's own code, so both ends are held to the same bytes:
//   node android/scripts/noise-vectors.ts
// The keys below are test values, filled with one byte each; they protect nothing.
import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { Initiator, Opener, publicKeyOf, Responder, seal } from "../../src/remote/noise.ts";
import { parsePairingLink, pairingLink, prologueFor } from "../../src/remote/protocol.ts";

const pair = (fill: number) => {
	const privateKey = Buffer.alloc(32, fill);
	return { privateKey, publicKey: publicKeyOf(privateKey) };
};
const computer = pair(1);
const phone = pair(2);
const phoneEphemeral = pair(3);
const computerEphemeral = pair(4);
const desktop = "AAECAwQFBgcICQoLDA0ODw";
const hello = '{"pair":"c2VjcmV0","name":"Pixel","app":"0.2.0"}';
const welcome = '{"desktop":"书房的电脑","version":"0.2.0","device":"d1"}';

const initiator = new Initiator({
	static: phone,
	remoteStatic: computer.publicKey,
	prologue: prologueFor(desktop),
	ephemeral: phoneEphemeral,
});
const responder = new Responder({
	static: computer,
	prologue: prologueFor(desktop),
	ephemeral: computerEphemeral,
});
const first = initiator.writeFirst(Buffer.from(hello));
if (responder.readFirst(first).toString() !== hello) throw new Error("the computer misread message 1");
const second = responder.writeSecond(Buffer.from(welcome));
const phoneSide = initiator.readSecond(second.message);

const request = '{"t":"req","id":1,"method":"GET","path":"/api/sessions?limit=200"}';
const response = '{"t":"res","id":1,"status":200,"type":"application/json","body":"{\\"items\\":[]}"}';
// Longer than one Noise message, so it travels as three chunks.
const long = Buffer.alloc(140_000);
for (let i = 0; i < long.length; i++) long[i] = i % 251;

const sha256 = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const requestParts = seal(phoneSide.session.send, Buffer.from(request));
const longParts = seal(phoneSide.session.send, long);
const responseParts = seal(second.session.send, Buffer.from(response));
// The computer reads what the phone sealed, as a check on this script itself.
const opener = new Opener(second.session.receive);
if (opener.open(requestParts[0] as Buffer)?.toString() !== request) throw new Error("request");

const link = pairingLink({
	relay: "wss://relay.tenonai.cn",
	desktop,
	key: computer.publicKey.toString("base64url"),
	secret: "c2VjcmV0",
	name: "书房的电脑 & Mac",
});
if (!parsePairingLink(link)) throw new Error("link");

const vectors = {
	computerPrivate: computer.privateKey.toString("hex"),
	computerPublic: computer.publicKey.toString("hex"),
	phonePrivate: phone.privateKey.toString("hex"),
	phonePublic: phone.publicKey.toString("hex"),
	phoneEphemeral: phoneEphemeral.privateKey.toString("hex"),
	desktop,
	hello,
	welcome,
	message1: first.toString("hex"),
	message2: second.message.toString("hex"),
	handshakeHash: phoneSide.session.handshakeHash.toString("hex"),
	request,
	requestSealed: requestParts.map((part) => part.toString("hex")),
	longLength: long.length,
	longSealedSha256: longParts.map(sha256),
	response,
	responseSealed: responseParts.map((part) => part.toString("hex")),
	link,
};
const out = new URL("../app/src/test/resources/noise-vectors.json", import.meta.url);
writeFileSync(out, `${JSON.stringify(vectors, null, "\t")}\n`);
process.stdout.write(`${out.pathname}\n`);
