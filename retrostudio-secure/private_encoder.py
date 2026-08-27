"""Private RetroStudio encoding engine. This module is never served as a static asset."""

from __future__ import annotations

import base64
import secrets
import textwrap


class EncoderInputError(ValueError):
    """Raised when source text is invalid for the private encoder."""


def encode_luau(source: str) -> tuple[str, dict[str, int]]:
    """Encode a Luau payload into a self-contained runtime wrapper.

    The operating implementation and validation remain server-side. The returned
    artifact includes only the minimum decoder needed by the user-owned script.
    """

    cleaned = source.replace("\r\n", "\n").replace("\r", "\n").strip()
    if not cleaned:
        raise EncoderInputError("Source cannot be empty.")
    if len(cleaned) > 16_000:
        raise EncoderInputError("Source is too large for one encoding request.")
    if "\x00" in cleaned:
        raise EncoderInputError("Source contains an unsupported control character.")

    nonce = secrets.token_bytes(16)
    key = nonce
    payload = cleaned.encode("utf-8")
    cipher = bytes(value ^ key[index % len(key)] for index, value in enumerate(payload))
    encoded = base64.b64encode(cipher).decode("ascii")
    nonce_hex = nonce.hex()

    # No original source appears in the response. The runtime decoder is generated
    # per artifact and does not reveal the server's validation or authorization flow.
    output = textwrap.dedent(
        f'''\
        -- RetroStudio protected artifact
        -- Generated server-side. Do not edit this header.
        local _p="{encoded}"
        local _n="{nonce_hex}"
        local _b="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
        local function _u(s)
          s=s:gsub("[^".._b.."=]","")
          return (s:gsub(".",function(x)
            if x=="=" then return "" end
            local r,f="",(_b:find(x,1,true)-1)
            for i=6,1,-1 do r=r..(f%2^i-f%2^(i-1)>0 and "1" or "0") end
            return r
          end):gsub("%d%d%d?%d?%d?%d?%d?%d?",function(x)
            if #x~=8 then return "" end
            local c=0
            for i=1,8 do c=c+(x:sub(i,i)=="1" and 2^(8-i) or 0) end
            return string.char(c)
          end))
        end
        local function _h(s)
          local t={{}}
          for i=1,#s,2 do t[#t+1]=tonumber(s:sub(i,i+1),16) end
          return t
        end
        local _k=_h(_n); local _d=_u(_p); local _o={{}}
        for i=1,#_d do _o[i]=string.char(bit32.bxor(string.byte(_d,i),_k[((i-1)%#_k)+1])) end
        local _f, _e=loadstring(table.concat(_o))
        if not _f then error("RetroStudio artifact could not be loaded: "..tostring(_e)) end
        return _f()
        '''
    )
    return output, {"input_characters": len(cleaned), "output_characters": len(output), "blocks": max(1, (len(payload) + 75) // 76)}
