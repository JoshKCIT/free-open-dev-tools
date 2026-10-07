"""Records what Python's email library makes of each message in messages.json, so a test can compare the tool with it.

Standard library only. Run it from a scratch virtual environment, never the machine's own Python:

    python -m venv <scratch>/venv-18
    <scratch>/venv-18/Scripts/python.exe record.py        (on Windows; bin/python on other systems)

It reads messages.json (JSON strings with CRLF escapes) from the folder this script is in, reads each string as the bytes of
a message with email.policy.default, and writes expected.json beside it. For each message it records the decoded From, To
and Subject headers, the mailboxes of From and To, every part (path, content type, file name, character set, decoded size
and SHA-256 of the decoded bytes) and the text of the first plain text body. The Python version and the time are written
inside the JSON. The unit test never runs Python; it only reads expected.json.

Part paths follow the tool's own numbering: the message is the empty path, the parts of a multipart are 1, 2, 3, the
message inside a message/rfc822 part is the part's path followed by .1, and its own parts continue from there.
"""
import datetime
import email
import email.policy
import hashlib
import json
import pathlib
import platform

HERE = pathlib.Path(__file__).resolve().parent


def header_text(message, name):
    value = message[name]
    return '' if value is None else str(value)


def mailboxes(message, name):
    value = message[name]
    if value is None:
        return []
    found = []
    for address in getattr(value, 'addresses', ()):
        found.append({'name': address.display_name, 'address': address.addr_spec})
    return found


def collect(part, path, out):
    entry = {
        'path': path,
        'contentType': part.get_content_type(),
        'filename': part.get_filename() or '',
        'charset': part.get_content_charset() or '',
        'size': None,
        'sha256': None,
    }
    multipart = part.is_multipart()
    if not multipart:
        data = part.get_payload(decode=True) or b''
        entry['size'] = len(data)
        entry['sha256'] = hashlib.sha256(data).hexdigest()
    out.append(entry)
    if multipart:
        for number, child in enumerate(part.get_payload(), 1):
            collect(child, (path + '.' if path else '') + str(number), out)


def first_text(message):
    body = message.get_body(preferencelist=('plain',))
    if body is None:
        return None
    return body.get_content()


def record_message(text):
    message = email.message_from_bytes(text.encode('ascii'), policy=email.policy.default)
    parts = []
    collect(message, '', parts)
    return {
        'from': header_text(message, 'From'),
        'to': header_text(message, 'To'),
        'subject': header_text(message, 'Subject'),
        'fromMailboxes': mailboxes(message, 'From'),
        'toMailboxes': mailboxes(message, 'To'),
        'parts': parts,
        'firstText': first_text(message),
    }


def main():
    corpus = json.loads((HERE / 'messages.json').read_text(encoding='ascii'))
    recorded = {name: record_message(entry['text']) for name, entry in corpus['messages'].items()}
    result = {
        'recordedAt': datetime.datetime.now(datetime.timezone.utc).strftime('%Y-%m-%dT%H:%M:%SZ'),
        'python': platform.python_version(),
        'library': 'email, policy email.policy.default',
        'messages': recorded,
    }
    (HERE / 'expected.json').write_text(json.dumps(result, indent=2, ensure_ascii=True) + '\n', encoding='ascii', newline='\n')
    print('recorded', len(recorded), 'messages with Python', result['python'])


if __name__ == '__main__':
    main()
