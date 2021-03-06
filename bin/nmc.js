#!/usr/bin/env node

// ':' //# comment; exec /usr/bin/env node "$0" "$@"
// Don't allow eslint to set semicolon after ':' above.
// http://sambal.org/2014/02/passing-options-node-shebang-line/

const path = require('path');
const { existsSync, readdirSync, statSync, openSync, closeSync } = require('fs');

const rimraf = require('rimraf');

const calcHash = require('../lib/calc-hash');
const logger = require('../lib/logger');
const { cacheDir, npmArgs, cwd } = require('../lib/common');
const { pack, unpack } = require('../lib/tar-utils');
const { spawnAndGetOutputsStr: spawn } = require('../lib/spawn-utils');

const npm = process.env.NPM_ORIG || 'npm';

process.on('unhandledRejection', error => {
  console.log('Unhandled Rejection Handler', error.message);
  process.exit(1);
});

function showHelp() {
  const { version } = require('../package.json');
  console.log(`Version: ${version}`);
  console.log('Usage: "nmc <npm arguments destined for installation the whole node_modules>" - runs npm with the specified arguments (saving node_modules in cache), or unzips archieve from cache.');
  console.log('"nmc --nmc-clean" - cleans the whole cache.');
  console.log('"nmc --nmc-cache-size" - returns size of current cache.');
  console.log('\n"Examples: "nmc ci", "nmc ci --production", "nmc install"');
  process.exit(0);
}

if (npmArgs.length === 0 || npmArgs[0] === '--help' || npmArgs[0] === '-h') {
  showHelp();
}

if (npmArgs[0] === '--nmc-clean') {
  rimraf.sync(cacheDir);
  logger.info('Cache is cleaned.\n');
  process.exit(0);
}

if (npmArgs[0] === '--nmc-cache-size') {

  let size = 0;
  const files = readdirSync(cacheDir);

  for (const file of files) {
    const fPath = path.join(cacheDir, file);
    size += statSync(fPath).size;
  }
  logger.info(`Cache size is ${(size / 1024 / 1024).toFixed(2)} MB.\n`);
  process.exit(0);
}

const timeLabel = 'nmc time';

console.time(timeLabel);

async function run() {

  const isGlobal = npmArgs.includes('-g');
  if (isGlobal) {
    logger.info('Global installation, nmc is ignored.\n');
    const res = await spawn({
      command: npm,
      args: npmArgs,
      cwd,
      exceptionIfErrorCode: true,
    });
    process.exit(res.code);
  }

  logger.info('Remove node_modules...');
  rimraf.sync(path.join(cwd, 'node_modules'));
  logger.info('Done.\n');

  const { hash, nameAndVersion } = await calcHash();
  const txzPath = path.join(cacheDir, `${hash}.txz`);
  const postinstallFlagPath = path.join(cacheDir, `${hash}.postinstall`);

  const exists = existsSync(txzPath);
  if (exists) {
    const fSize = statSync(txzPath).size;
    if (fSize > 10) {
      logger.info('Hash found in cache, unzipping...\n');
      unpack(cwd, txzPath);
      logger.info('Unzipping is done, let`s check for postinstall.\n');

      if (existsSync(postinstallFlagPath)) {
        logger.info('Postinstall flag is found, let`s run it.\n');
        await spawn({
          command: npm,
          args: ['run', 'postinstall'],
          exceptionIfErrorCode: true,
        });
        logger.info('Postinstall is finished.\n');
      }

      console.timeEnd(timeLabel);
      process.exit(0);
    }
  }

  logger.info(`Hash not found in cache, installing as npm ${npmArgs.join(' ')} ...\n`);

  // Use for debug.
  // delete process.env.NODE_OPTIONS;
  // delete process.env.JS_DEBUG_FILE;

  const res = await spawn({
    command: npm,
    args: npmArgs,
    cwd,
    exceptionIfErrorCode: true,
  });

  if (res.out.includes(`${nameAndVersion} postinstall`)) {
    logger.info('Postinstall is detected, let`s save it.\n');
    closeSync(openSync(postinstallFlagPath, 'w'));
  }

  logger.info('Installing is done, zipping...\n');

  pack(cwd, txzPath, ['node_modules']);

  logger.info('Zipping is done.\n');
  console.timeEnd(timeLabel);
}

run();
