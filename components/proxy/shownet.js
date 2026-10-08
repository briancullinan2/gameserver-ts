/// <reference types="node" />
// @ts-check

/**
 * Utility to format binary stream into safe printable ASCII.
 * @param {Buffer} message
 * @returns {string}
 */
function convertPrintable(message)
{
	return Array.from(message)
		.map(c => (c >= 20 && c <= 127 ? String.fromCharCode(c) : '.'))
		.join('');
}



function SHOWNET(message, socket, client, websocket)
{
	var unzipped;
	//return;
	if(message === true) return;
	if(message[0] === 255 && message[1] === 255
		&& message[2] === 255 && message[3] === 255)
	{
		var msg = convertPrintable(message);
		unzipped = [(websocket ? '*' : '') + (client ? '--> client' : '<-- server'), msg];
		if(msg.match(/connectResponse/ig))
		{
			socket.challenge = parseInt(msg.substr(20));
			socket.compat = false;
			socket.incomingSequence = 0;
			socket.fragmentSequence = 0;
			socket.serverSequence = 0;
		} else if(msg.match(/connect\s/ig))
		{
			var decompressed = decompressMessage(message, 12);
			decompressed = convertPrintable(decompressed);
			unzipped = [(websocket ? '*' : '') + (client ? '--> client' : '<-- server'), msg.substr(0, 12) + decompressed];
		}
	} else
	{
		//console.log(Array.from(message))

		var read = 0;
		var sequence = SwapLong(read, message);
		read += 32;
		var fragment = (sequence >>> 31) === 1;
		if(fragment)
		{
			sequence &= ~(1 << 31);
		}
		if(client)
		{ // from client to server qport=*
			read += 16;
		}

		var valid = false;
		if(!socket.compat)
		{
			var checksum = SwapLong(read, message);
			read += 32;
			valid = NETCHAN_GENCHECKSUM(socket.challenge, sequence) === checksum;
		}

		var fragmentStart = 0;
		var fragmentLength = 0;
		if(fragment)
		{
			fragmentStart = SwapShort(read, message);
			read += 16;
			fragmentLength = SwapShort(read, message);
			read += 16;
		}

		if((!client && sequence <= socket.incomingSequence)
			|| (client && sequence <= socket.serverSequence))
		{
			console.log([(websocket ? '*' : '') + (client ? '--> client' : '<-- server'), 'Out of order packet', sequence, socket.incomingSequence]);
			return false;
		}

		socket.dropped = sequence - (socket.incomingSequence + 1);

		if(fragment)
		{
			console.log([(websocket ? '*' : '') + (client ? '--> client' : '<-- server'), 'fragment']);

			// TODO: implement fragment and only return on final message
			if(!socket.fragmentBuffer) socket.fragmentBuffer = Buffer.from([]);
			if(sequence != socket.fragmentSequence)
			{
				socket.fragmentSequence = sequence;
				socket.fragmentLength = 0;
				socket.fragmentBuffer = Buffer.from([]);
			}

			if(fragmentStart != socket.fragmentLength)
			{
				return false;
			}

			socket.fragmentBuffer = Buffer.concat([
				Buffer.from(socket.fragmentBuffer),
				Buffer.from(message.subarray(read >> 3, (read >> 3) + fragmentLength))
			]);
			socket.fragmentLength += fragmentLength;

			if(fragmentLength == FRAGMENT_SIZE)
			{
				return false;
			}

			if(socket.fragmentLength > MAX_MSGLEN)
			{
				return false;
			}

			// make sure the message sequence is still there
			message = Buffer.concat([
				new Uint8Array(4),
				Buffer.from(socket.fragmentBuffer)
			]);
			read = 32;
			socket.fragmentBuffer = Buffer.from([]);
			socket.fragmentLength = 0;
		}

		if(!client)
		{
			socket.incomingSequence = sequence;
		} else
		{
			socket.serverSequence = sequence;
		}
		//var serverSeq = SwapLong(0, message)

		// start decoding with MSG_Bitstream()
		// finished parsing header
		if(client)
		{
			read = readBits(message, read, 32);
			var serverId = read[1];

			read = readBits(message, read[0], 32);
			var ack = read[1];
			if(ack < 0)
			{
				console.log([(websocket ? '*' : '') + (client ? '--> client' : '<-- server'), 'Illegible client message', serverId, ack]);
				return;
			}
			read = readBits(message, read[0], 32);
			var reliableAcknowledge = read[1];
			if(reliableAcknowledge < socket.reliableSequence - MAX_RELIABLE_COMMANDS)
			{
				console.log([(websocket ? '*' : '') + (client ? '--> client' : '<-- server'), 'Unreliable client message', serverId, reliableAcknowledge]);
				return;
			}
			read = readBits(message, read[0], 8);
			var cmd = read[1];

			switch(cmd)
			{
				case 0: // clc_bad
					break;
				case 1: // clc_nop
					break;
				case 2: // clc_move
					break;
				case 3: // clc_moveNoDelta
					break;
				case 4: // clc_clientCommand
					break;
				case 5: // clc_EOF
					break;
				case 6: // clc_voipSpeex
					break;
				case 7: // clc_voipOpus
					break;
				default:
			}

			unzipped = [(websocket ? '*' : '') + (client ? '--> client' : '<-- server'), clc_strings[cmd], read[1]];
		} else
		{
			read = readBits(message, read, 32);
			var ack = read[1];
			read = readBits(message, read[0], 8);
			var cmd = read[1];
			switch(cmd)
			{
				case 0: // svc_bad
					break;
				case 1: // svc_nop
					break;
				case 2: // svc_gamestate
					read = readBits(message, read[0], 64);
					var seq = read[1];
					/*
					while(true) {
					  read = readBits(message, read[0], 8)
					  switch(read[1]) {
						case 3:
						  read = readBits(message, read[0], 16)
						  read = ReadString(read, message)
						break
						case 4:
						break
						case 8:
						break
					  }
					  if(read[1] === 8 || read[1] === 0) break
					}
					*/
					break;
				case 3: // svc_configstring
					break;
				case 4: // svc_baseline
					break;
				case 5: // svc_serverCommand
					read = readBits(message, read[0], 32);
					var seq = read[1];
					read = ReadString(read, message);
					break;
				case 6: // svc_download
					break;
				case 7: // svc_snapshot
					break;
				case 8: // svc_EOF
					break;
				case 9: // svc_voipSpeex
					break;
				case 10: // svc_voipOpus
					break;
				case 16: // svc_multiview
					break;
				case 17: // svc_zcmd
					break;
				default:
			}
			unzipped = [(websocket ? '*' : '') + (client ? '--> client' : '<-- server'), svc_strings[cmd], read[1]];
		}
		//unzipped = [client ? 'client' : 'server', sequence, fragment, fragmentStart, fragmentLength, cmd, svc_strings[cmd]]
	}
	console.log(unzipped);
}

module.exports = SHOWNET;


function NETCHAN_GENCHECKSUM(challenge, sequence)
{
	return (challenge) ^ ((sequence) * (challenge));
}

function SV_ConnectionlessPacket()
{

}

function Netchan_Process()
{

}

function SwapLong(read, message)
{
	return (message[(read >> 3) + 3] << 24) + (message[(read >> 3) + 2] << 16)
		+ (message[(read >> 3) + 1] << 8) + message[(read >> 3)];
}

function SwapShort(read, message)
{
	return (message[(read >> 3) + 1] << 8) + message[(read >> 3)];
}

function ReadString(read, message)
{
	var result = '';
	do
	{
		read = readBits(message, read[0], 8); // use ReadByte so -1 is out of bounds
		var c = read[1];
		if(c <= 0 /*c == -1 || c == 0 */ || result.length >= MAX_STRING_CHARS - 1)
		{
			break;
		}
		// translate all fmt spec to avoid crash bugs
		if(c == '%')
		{
			c = '.';
		} else
			// don't allow higher ascii values
			if(c > 127)
			{
				c = '.';
			}
		result += String.fromCharCode(c);
	} while(true);
	return [read[0], result];
}

function decompressMessage(message, offset)
{
	message.forEach((c, i) => Huffman.HEAP8[msgData + i] = c);
	Huffman.HEAP32[(msg >> 2) + 5] = message.length;
	Huffman._Huff_Decompress(msg, 12);
	return Huffman.HEAP8.slice(msgData + offset, msgData + Huffman.HEAP32[(msg >> 2) + 5]);
}


function readBits(m, offset, bits = 8)
{
	var value = 0;
	var nbits = bits & 7;
	var bitIndex = offset;
	m.forEach((c, i) => Huffman.HEAP8[buffer + i] = c);
	if(nbits)
	{
		for(let i = 0; i < nbits; i++)
		{
			value |= Huffman._HuffmanGetBit(buffer, bitIndex) << i;
			bitIndex++;
		}
		bits -= nbits;
	}
	if(bits)
	{
		for(let i = 0; i < bits; i += 8)
		{
			bitIndex += Huffman._HuffmanGetSymbol(sym, buffer, bitIndex);
			value |= (Huffman.getValue(sym) << (i + nbits));
		}
	}
	return [bitIndex, value];
}
