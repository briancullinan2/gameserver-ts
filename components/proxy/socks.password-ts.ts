import { Socket } from 'node:net';
import { Duplex } from 'node:stream';

export type AuthCallback = (
	user: string,
	pass: string,
	done: (success: boolean) => void
) => void;

export type ServerCompletionCallback = (errOrSuccess: Error | boolean) => void;
export type ClientCompletionCallback = (success: boolean | Error) => void;

enum ServerState
{
	VERSION = 0,
	ULEN = 1,
	UNAME = 2,
	PLEN = 3,
	PASSWD = 4,
}

enum ClientState
{
	VERSION = 0,
	STATUS = 1,
}

const BUF_SUCCESS = Buffer.from([0x01, 0x00]);
const BUF_FAILURE = Buffer.from([0x01, 0x01]);

export class UserPasswordAuthHandler
{
	public readonly METHOD = 0x02;

	private authCallback?: AuthCallback;
	private username?: string;
	private password?: string;
	private userLen: number = 0;
	private passLen: number = 0;

	/**
	 * Initialize for Server mode with an authentication callback
	 */
	constructor(authCallback: AuthCallback);
	/**
	 * Initialize for Client mode with username and password
	 */
	constructor(username: string, password: string);
	constructor(authCbOrUser: AuthCallback | string, password?: string)
	{
		if(typeof authCbOrUser === 'function')
		{
			this.authCallback = authCbOrUser;
		} else if(typeof authCbOrUser === 'string' && typeof password === 'string')
		{
			this.username = authCbOrUser;
			this.password = password;
			this.userLen = Buffer.byteLength(this.username);
			this.passLen = Buffer.byteLength(this.password);

			if(this.userLen > 255)
			{
				throw new Error('Username too long (limited to 255 bytes)');
			}
			if(this.passLen > 255)
			{
				throw new Error('Password too long (limited to 255 bytes)');
			}
		} else
		{
			throw new Error('Invalid arguments provided to UserPasswordAuthHandler constructor');
		}
	}

	/**
	 * Handles SOCKS5 Subnegotiation Username/Password Auth on the Server
	 */
	public server(stream: Duplex, cb: ServerCompletionCallback): void
	{
		if(!this.authCallback)
		{
			throw new Error('Server handler invoked without an auth callback');
		}

		let state = ServerState.VERSION;
		let userBuffer: Buffer = Buffer.alloc(0);
		let passBuffer: Buffer = Buffer.alloc(0);
		let userPos = 0;
		let passPos = 0;
		let usernameStr = '';

		const onData = (chunk: Buffer) =>
		{
			let i = 0;
			const len = chunk.length;

			while(i < len)
			{
				switch(state)
				{
					/*
					  +----+------+----------+------+----------+
					  |VER | ULEN |  UNAME   | PLEN |  PASSWD  |
					  +----+------+----------+------+----------+
					  | 1  |  1   | 1 to 255 |  1   | 1 to 255 |
					  +----+------+----------+------+----------+
					*/
					case ServerState.VERSION: {
						if(chunk[i] !== 0x01)
						{
							stream.removeListener('data', onData);
							return cb(new Error(`Unsupported auth request version: ${chunk[i]}`));
						}
						i++;
						state = ServerState.ULEN;
						break;
					}

					case ServerState.ULEN: {
						const ulen = chunk[i];
						if(ulen === 0)
						{
							stream.removeListener('data', onData);
							return cb(new Error('Bad username length (0)'));
						}
						i++;
						state = ServerState.UNAME;
						userBuffer = Buffer.alloc(ulen);
						userPos = 0;
						break;
					}

					case ServerState.UNAME: {
						const remainingTarget = userBuffer.length - userPos;
						const remainingChunk = len - i;
						const bytesToCopy = Math.min(remainingTarget, remainingChunk);

						chunk.copy(userBuffer, userPos, i, i + bytesToCopy);
						userPos += bytesToCopy;
						i += bytesToCopy;

						if(userPos === userBuffer.length)
						{
							usernameStr = userBuffer.toString('utf8');
							state = ServerState.PLEN;
						}
						break;
					}

					case ServerState.PLEN: {
						const plen = chunk[i];
						if(plen === 0)
						{
							stream.removeListener('data', onData);
							return cb(new Error('Bad password length (0)'));
						}
						i++;
						state = ServerState.PASSWD;
						passBuffer = Buffer.alloc(plen);
						passPos = 0;
						break;
					}

					case ServerState.PASSWD: {
						const remainingTarget = passBuffer.length - passPos;
						const remainingChunk = len - i;
						const bytesToCopy = Math.min(remainingTarget, remainingChunk);

						chunk.copy(passBuffer, passPos, i, i + bytesToCopy);
						passPos += bytesToCopy;
						i += bytesToCopy;

						if(passPos === passBuffer.length)
						{
							stream.removeListener('data', onData);
							const passwordStr = passBuffer.toString('utf8');
							state = ServerState.VERSION;

							if(i < len)
							{
								stream.unshift(chunk.subarray(i));
							}

							this.authCallback!(usernameStr, passwordStr, (success: boolean) =>
							{
								if(stream.writable)
								{
									stream.write(success ? BUF_SUCCESS : BUF_FAILURE);
									cb(success);
								}
							});
							return;
						}
						break;
					}
				}
			}
		};

		stream.on('data', onData);
	}

	/**
	 * Handles SOCKS5 Subnegotiation Username/Password Auth on the Client
	 */
	public client(stream: Duplex, cb: ClientCompletionCallback): void
	{
		if(this.username === undefined || this.password === undefined)
		{
			throw new Error('Client handler invoked without credentials');
		}

		let state = ClientState.VERSION;

		const onData = (chunk: Buffer) =>
		{
			let i = 0;
			const len = chunk.length;

			while(i < len)
			{
				switch(state)
				{
					/*
					  +----+--------+
					  |VER | STATUS |
					  +----+--------+
					  | 1  |   1    |
					  +----+--------+
					*/
					case ClientState.VERSION: {
						if(chunk[i] !== 0x01)
						{
							stream.removeListener('data', onData);
							return cb(new Error(`Unsupported auth request version: ${chunk[i]}`));
						}
						i++;
						state = ClientState.STATUS;
						break;
					}

					case ClientState.STATUS: {
						const status = chunk[i];
						i++;
						state = ClientState.VERSION;

						if(i < len)
						{
							stream.unshift(chunk.subarray(i));
						}

						stream.removeListener('data', onData);
						return cb(status === 0);
					}
				}
			}
		};

		stream.on('data', onData);

		// Build subnegotiation request buffer
		const buf = Buffer.alloc(3 + this.userLen + this.passLen);
		buf[0] = 0x01; // Version
		buf[1] = this.userLen;
		buf.write(this.username, 2, this.userLen, 'utf8');
		buf[2 + this.userLen] = this.passLen;
		buf.write(this.password, 3 + this.userLen, this.passLen, 'utf8');

		stream.write(buf);
	}
}

// Factory function export for backward compatibility with existing codebase
export default function UserPasswordAuthHandlers(
	authCallbackOrUser: AuthCallback | string,
	password?: string
)
{
	return new UserPasswordAuthHandler(
		authCallbackOrUser as any,
		password as any
	);
}
