'use strict';

function publicReadme(components) {
  const cell = value => String(value || '').replace(/\r?\n/g, ' ').replace(/\|/g, '\\|');
  const rows = components.filter(component => component.kind === 'app')
    .concat(components.filter(component => component.kind === 'tool'));
  const packages = rows.length ? '| Package | Version | Purpose |\n|---|---|---|\n' +
    rows.map(component => `| **${cell(component.title)}**${component.kind === 'tool' ? '<br>Tool' : ''} | \`${component.version}\` | ${cell(component.description)} |`).join('\n') :
    'No packages have been published yet.';
  const hmis = [...new Set(components.flatMap(component => component.mguHmi || []))].sort()
    .map(hmi => hmi === 'ID7' ? 'iDrive 7' : 'iDrive 8').join(' & ');
  const firstApp = components.find(component => component.kind === 'app');
  const installTarget = firstApp ? `**${cell(firstApp.title)}**` : 'an app';
  const status = components.length ? '> **Preview status** — Vehicle and diagnostic-client compatibility are still\n> being verified. The platform label identifies the package target, not\n> confirmation that it works on every car.' : '> **Catalog status** — No packages are published yet.';
  return `# MGU Apps

Apps and companion services for your BMW head unit.

**${hmis || 'BMW MGU'}** · Development preview

[Packages](#available-packages) · [Installation](#get-started) · [Licenses](#credits-and-licenses)

---

Install and manage these packages through the
[MGU Store](https://github.com/robertnisipeanu/mgu-store).

${status}

## Available packages

${packages}

${firstApp ? 'Choose the app in the Store; its required companion service is installed with it.' : 'New apps and tools will be listed here as they become available.'}

## Get started

1. **Set up the Store.** Follow the installation guide in
   [mgu-store](https://github.com/robertnisipeanu/mgu-store).
2. **Connect this catalog.** Open [catalog.json](catalog.json) on GitHub and select
   **Raw**. Copy that full HTTPS address into **Settings → Add source** in the Store.
${firstApp ? `3. **Install your app.** Select ${installTarget}, choose **Install**, and restart\n   the head unit if prompted.` : '3. **Choose a package when available.** Published apps and tools will appear in the Store.'}

Use the raw catalog address when adding the source; a GitHub repository name
selects a different package format.

<details>
<summary><strong>Install offline with a USB stick</strong></summary>

1. Copy the distribution files into \`mgu-repo/noahg-apps/\` on a USB stick.
   Keep \`catalog.json\` at that folder's root and preserve the \`apps/\` and \`tools/\` subfolders.
2. Connect the stick to the car and open the Store's **USB** page.
${firstApp ? `3. Choose ${installTarget} and select **Install**.` : '3. Select a published package from the USB source when one is available.'}

</details>

## Distribution files

[\`catalog.json\`](catalog.json) lists the available versions and dependencies.
[\`apps/\`](apps/) holds app packages and Store icons; [\`tools/\`](tools/) holds companion tool packages.
The Store verifies package sizes and checksums and supplies the BMW SDK locally.

## Credits and licenses

Third-party runtime and font notices are included with the packages and in
[licenses/](licenses/). See [third-party notices](THIRD_PARTY_NOTICES.md) for details.
`;
}

module.exports = { publicReadme };
