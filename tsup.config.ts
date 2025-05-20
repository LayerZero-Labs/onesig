import { defineConfig } from 'tsup'

// XXX:TODO Fix shared config so we can use here.
export default defineConfig({
    format: ['cjs', 'esm'],
    outExtension({ format }) {
        return {
            js: format === 'esm' ? '.mjs' : '.js',
        }
    },
    outDir: './dist',
    dts: true,
    platform: 'neutral',
})
