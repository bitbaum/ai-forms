import { fileURLToPath } from 'node:url';

/** @type {import('next').NextConfig} */
export default {
  // The example sits inside the package repo, so Next finds two lockfiles and
  // guesses wrong about the workspace root. Pin it to this directory.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),
};
