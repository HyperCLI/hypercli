// Expands cli/tests/ci-matrix.json into the gate/smoke job matrices for
// .github/workflows/cli.yml. Emits `gates` and `smokes` outputs to
// $GITHUB_OUTPUT. Kept as a file (not a heredoc) so YAML indentation can
// never corrupt it. All jobs run self-hosted Linux; Windows is not gated.
import { appendFileSync } from 'node:fs';
import { readFileSync } from 'node:fs';

const manifest = JSON.parse(readFileSync('tests/ci-matrix.json', 'utf8'));
const gates = { include: [] };
const smokes = { include: [] };

for (const [group, spec] of Object.entries(manifest.groups)) {
  gates.include.push({ group });
  for (const smoke of spec.smokes) {
    const argv = group === 'core' ? [...smoke.argv] : [group, ...smoke.argv];
    const stripped = [...argv];
    if (stripped[stripped.length - 1] === '--help') stripped.pop();
    // Bare group --help (and root help) runs inside the group gate,
    // not as a matrix check — the names would collide.
    if (group === 'core' ? stripped.length === 0 : stripped.length <= 1) continue;
    const sub = (group === 'core' ? stripped : stripped.slice(1)).join(' ');
    smokes.include.push({ name: `${group} / ${sub}`, argv: argv.join(' ') });
  }
}

const out = process.env.GITHUB_OUTPUT;
if (!out) throw new Error('GITHUB_OUTPUT is not set');
appendFileSync(out, `gates=${JSON.stringify(gates)}\nsmokes=${JSON.stringify(smokes)}\n`);
console.log(`gates: ${gates.include.length}, smokes: ${smokes.include.length}`);
