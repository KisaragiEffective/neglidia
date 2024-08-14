import yargs from 'yargs';
import { lstatSync } from 'node:fs';
import { run } from './cli.js';

const args = yargs(process.argv)
	.command("compare", "parse file")
	.string('old')
	.string('new')
	.string('out')
	.demandOption(['old', 'new', 'out'])
	.demandCommand(1)
	.parseSync();

// #region 引数の検証
if (lstatSync(args.old).isDirectory()) {
	throw new RangeError('older path is a directory');
}

if (lstatSync(args.new).isDirectory()) {
	throw new RangeError('newer path is a directory');
}
// #endregion

await run(args);
