// Prints fresh, throwaway Convex Auth signing keys for the isolated local
// test backend as two lines: the private key (newlines as spaces) and JWKS.
import { exportJWK, exportPKCS8, generateKeyPair } from "jose";

const keys = await generateKeyPair("RS256", { extractable: true });
const privateKey = await exportPKCS8(keys.privateKey);
const publicKey = await exportJWK(keys.publicKey);
process.stdout.write(`${privateKey.trimEnd().replace(/\n/g, " ")}\n`);
process.stdout.write(`${JSON.stringify({ keys: [{ use: "sig", ...publicKey }] })}\n`);
