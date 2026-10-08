
const path = require('path');
const fs = require('fs');
// const CopyWebpackPlugin = require('copy-webpack-plugin');
const TerserPlugin = require('terser-webpack-plugin');
// const HtmlWebpackPlugin = require('html-webpack-plugin');
// const webpack = require('webpack');

module.exports = {
	mode: 'production',
	devtool: 'inline-source-map',
	entry: './node_modules/happy-dom-without-node/lib/index.js',
	target: 'web',
	output: {
		filename: 'jsdom.bundle.js',
		path: path.resolve(__dirname, 'dist'),
		clean: true,
		// library: {
		// 	name: 'TemplateModule', // Accessible via window.TemplateModule OR module export
		// 	type: 'umd',           // Works for CommonJS, AMD, and script tag globals
		// 	export: 'default',     // Bundles default exports
		// },
		globalObject: 'globalThis'
		//library: {
		//	type: 'window', // Exposes exports directly to window.TemplateWidget, window.LayoutWidget, etc.
		//},
	},
	stats: 'verbose', // Generates comprehensive build stream analytics
	stats: {
		errorDetails: true, // Forces display of exact file resolution traces
		colors: true,
		modules: true,
		reasons: true
	},
	resolve: {
		extensions: ['.ts', '.js', '.css'],
	},
	externals: {
		// '@lumino/dragdrop': 'Lumino.dragdrop',
	},
	module: {
		noParse: [/[\\/]node_modules[\\/]@babel[\\/]standalone[\\/]/, /\.min\./],
		rules: [
			{
				// require.resolve returns the exact absolute path to the node_modules entrypoint
				test: require.resolve('diff'),
				use: [
					{
						loader: 'expose-loader',
						options: {
							// This registers it directly on window.diff and diff
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
		{
			apply: (compiler) =>
			{
				// 'afterDone' triggers ONLY after the entire build is finished and written to disk
				compiler.hooks.afterDone.tap('CopyToDocsPlugin', () =>
				{
					try
					{
						// Deep copy the fresh dist folder to docs
						fs.copyFileSync(path.resolve(__dirname, 'dist/jsdom.bundle.js'), path.resolve(__dirname, 'components/ripper/jsdom.bundle.js'));
						console.log('\n🚀 Success: Dynamically mirrored "dist" into "docs" folder.');
					} catch(err)
					{
						console.error('\n❌ Failed to copy assets to docs directory:', err);
					}
				});
			},
		},
	],
	performance: {
		hints: false,
	},
	optimization: {
		minimize: true,
		minimizer: [
			new TerserPlugin({
				exclude: /babel\.min\.js$/,
				parallel: true,
				terserOptions: {
					// Prevents name mangling stripping
					mangle: {
						keep_fnames: true,
						keep_classnames: true, // Optional: keeps class names intact too
					},
					// Prevents optimization passes from discarding or renaming structures
					compress: {
						keep_fnames: true,
						keep_classnames: true,
					}
				},
			}),
		],
	},
};
