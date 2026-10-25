// Code generation registry: one module per target language, each exposing the
// same interface — query(ctx), crud(keyInfo, table, region), sdk(table, keyInfo, region).
// Pure functions (no DOM), so they can be unit-tested in Node.
import nodejs from './languages/nodejs.js';
import python from './languages/python.js';
import java from './languages/java.js';
import csharp from './languages/csharp.js';
import go from './languages/go.js';
import ruby from './languages/ruby.js';
import php from './languages/php.js';
import cli from './languages/cli.js';
import { toKebabCase } from './naming.js';

export const LANGUAGES = Object.fromEntries(
    [nodejs, python, java, csharp, go, ruby, php, cli].map((lang) => [lang.id, lang]),
);

function language(id) {
    const lang = LANGUAGES[id];
    if (!lang) throw new Error(`Unsupported language: ${id}`);
    return lang;
}

/** Snippet reproducing the current Scan / Query / PartiQL statement. */
export const generateQuery = (langId, ctx) => language(langId).query(ctx);

/** Full create / get / list / update / delete example for the table. */
export const generateCrud = (langId, keyInfo, table, region) => language(langId).crud(keyInfo, table, region);

/** SDK project as { relativePath: fileContent }. */
export const generateSdkFiles = (langId, table, keyInfo, region) => language(langId).sdk(table, keyInfo, region);

/** Root folder name used inside the SDK zip. */
export const sdkRootFolder = (table) => `${toKebabCase(table)}-dynamo-sdk`;
