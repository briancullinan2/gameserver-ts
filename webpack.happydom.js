const path = require('path');
const fs = require('fs');
const TerserPlugin = require('terser-webpack-plugin');
const webpack = require('webpack');

module.exports = {
	mode: 'production',
	devtool: 'inline-source-map',
	// 1. Dynamically resolve entrypoint path
	entry: './components/ripper/happy-entry.ts',
	target: 'web', // Optimized for Web Workers & Web browser environments
	output: {
		filename: 'happydom.bundle.js',
		path: path.resolve(__dirname, 'dist'),
		clean: true,
		// 2. CRITICAL: Allows UMD bundle to attach to 'self' inside Web Workers
		globalObject: 'globalThis',
		library: {
			name: 'HappyDOM',
			type: 'global'
		}
		//library: {
		//name: 'HappyDOM',
		//type: 'umd',
		//export: 'default',
		//},
	},
	stats: {
		errorDetails: true,
		colors: true,
		modules: true,
		reasons: true
	},
	resolve: {
		extensions: ['.ts', '.js', '.json', '.css'],
		// 3. Prevent Node.js core module resolution failures
		fallback: {
			fs: false,
			path: false,
			child_process: false,
			buffer: false
		}
	},
	module: {
		noParse: [/[\\/]node_modules[\\/]@babel[\\/]standalone[\\/]/, /\.min\./],
		rules: [
			{
				test: require.resolve('diff'),
				use: [
					{
						loader: 'expose-loader',
						options: {
							exposes: ['diff'],
						},
					},
				],
			},
			{
				test: /\.ts$/,
				use: 'ts-loader',
				exclude: /node_modules/,
			},
			{
				test: /\.css$/,
				use: [
					'style-loader',
					{
						loader: 'css-loader',
						options: { sourceMap: true }
					}
				]
			},
		],
	},
	plugins: [
		new webpack.optimize.LimitChunkCountPlugin({
			maxChunks: 1,
		}),
		// new webpack.ProvidePlugin({
		// 	process: 'process/browser',
		// 	Buffer: ['buffer', 'Buffer']
		// }),
		{
			apply: (compiler) =>
			{
				compiler.hooks.afterDone.tap('CopyToDocsPlugin', () =>
				{
					try
					{
						const targetDir = path.resolve(__dirname, 'components/ripper');
						if(!fs.existsSync(targetDir))
						{
							fs.mkdirSync(targetDir, { recursive: true });
						}
						fs.copyFileSync(
							path.resolve(__dirname, 'dist/happydom.bundle.js'),
							path.join(targetDir, 'happydom.bundle.js')
						);
						console.log('\n🚀 Success: Dynamically mirrored "dist" into "components/ripper" folder.');
					} catch(err)
					{
						console.error('\n❌ Failed to copy assets directory:', err);
					}
				});
			},
		},
	],
	performance: {
		hints: false,
	},
	optimization: {
		splitChunks: false,
		runtimeChunk: false,
		minimize: true,
		minimizer: [
			new TerserPlugin({
				parallel: true,
				terserOptions: {
					mangle: false, // DO NOT MANGLE CLASS/FUNCTION NAMES
					keep_classnames: true,
					keep_fnames: true,
					compress: {
						drop_debugger: false,
						keep_classnames: true,
						keep_fnames: true
					}
				}
			})
		]
	}
};
