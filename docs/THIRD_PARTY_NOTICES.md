# Third-party notices

## PPTist

SlideMind integrates source code from [PPTist](https://github.com/pipipi-pikachu/PPTist), pinned at commit `e4912589ffdbec389fcc1bf25a85852dfe3040a8`.

PPTist is copyright © 2020-present pipipi-pikachu and contributors, and is licensed under the GNU Affero General Public License v3.0. The full license text is provided in `LICENSE`.

SlideMind's PPTist bridge and integration changes are distributed as part of this repository under the same AGPL-3.0-only license.

## Web content extraction

SlideMind's internal Web tools use these pinned extraction libraries:

- [Mozilla Readability 0.6.0](https://github.com/mozilla/readability), licensed under the Apache License 2.0.
- [linkedom 0.16.0](https://github.com/WebReflection/linkedom), licensed under the ISC License.

The corresponding package license texts are distributed with the packaged dependencies.

## Apache Tika

SlideMind bundles Apache Tika Server Standard 4.0.0 and its adjacent runtime dependencies for local DOC, DOCX, XLS, XLSX, and PDF text extraction. Apache Tika is licensed under the Apache License 2.0. The upstream `LICENSE` and `NOTICE` files are preserved beside the packaged Tika runtime.

## Eclipse Temurin

SlideMind bundles a custom Java runtime linked from Eclipse Temurin JDK 21.0.12.1+1 to run Apache Tika without relying on a system Java installation. The default image uses jlink resource compression and debug-information removal with a reduced module set; a full upstream JRE fallback is available. The complete upstream `NOTICE` and per-module `legal` directory are preserved in each packaged JRE. Temurin/OpenJDK is distributed under GPL-2.0-only with the Classpath Exception and includes components under additional licenses documented in that directory.

## Pandoc

SlideMind bundles a pinned Pandoc 3.11 executable for local Markdown-to-DOCX conversion. Pandoc is copyright © 2006–2024 John MacFarlane and is distributed under GPL-2.0-or-later; embedded components and templates carry the additional compatible notices recorded in Pandoc's `COPYRIGHT` file.

Each packaged runtime preserves the upstream `COPYING.md` and `COPYRIGHT` files beside the executable and includes the checksum-verified `pandoc-3.11.tar.gz` corresponding-source archive. The packaging gate rejects a missing or modified source archive.

## PDFKit

SlideMind uses [PDFKit 0.17.2](https://github.com/foliojs/pdfkit) to assemble rendered presentation slides into PDF files. PDFKit is licensed under the MIT License. Its package license text is distributed with the packaged dependency.

## Host-managed configuration patches

SlideMind modifies the distributed JavaScript of Pi Coding Agent 0.85.1 and Pi AI 0.85.1 (MIT), and OpenAI Node SDK 6.40.0 (Apache-2.0), using the version-pinned pnpm patches in `patches/`. The modifications provide explicit provider/auth-context injection and disable ambient package-path, provider-setting, and OpenAI client environment configuration. Original license files remain distributed with each dependency. These changes apply to the embedded SlideMind runtime and are not claims about upstream defaults.
