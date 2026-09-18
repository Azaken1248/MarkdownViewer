// Open the database in the directory named, and exit. That is the whole job:
// the db suite forks eight of these at the same instant against a file that
// does not exist yet, and any one that exits non-zero was refused.
require("../../lib/db").open(process.argv[2]);
process.exit(0);
