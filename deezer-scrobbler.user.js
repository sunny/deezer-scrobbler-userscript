// ==UserScript==
// @name          Deezer Scrobbler
// @namespace     http://sunfox.org/
// @description   Scrobbles the currently playing title in deezer to last.fm
// @include       http://www.deezer.com/*
// ==/UserScript==

dzs = {}

// Lastfm API vars
dzs.user = GM_getValue('dzs_user')
dzs.token = GM_getValue('dzs_token')
dzs.session_key = GM_getValue('dzs_session_key')
dzs.api_key = '2f4a8d27f538fc7bd5a772a9f311197f'
dzs.shared_secret = '14e2dfb03533fb08b0aa59020e7a0bb1'
dzs.client_id = 'dzs'
dzs.client_version = '1.0'
dzs.now_playing_url = null
dzs.submission_url = null
dzs.session_id = null

// Deezer Scrobbler vars
dzs.last_update = null
dzs.last_artist = null
dzs.last_track = null

// Go !
window.addEventListener('load', function() {
  GM_log('Token: ' + dzs.token +' User: '+ dzs.user +' Session key: ' + dzs.session_key)

  // No token? Get one, then redirect the user to authorize app
  if (!dzs.token)
    return dzs.get_token(function() {
      GM_setValue('dzs_token', dzs.token)
      var url = 'http://www.last.fm/api/auth/?api_key='+dzs.api_key+'&token='+dzs.token
      alert("Pour utiliser Deezer Scrobbler vous devez accepter l'application dans last.fm. Quand vous cliquerez sur OK une page last.fm s'ouvrira qui vous permettra d'autoriser Deezer Scrobbler à scrobbler à votre place. Une fois accepté merci de recharger Deezer.")
      window.open(url)
    })

  // No session key? Get one with the user name as well
  if (!dzs.session_key)
    dzs.get_session(function() {
      GM_setValue('dzs_session_key', dzs.session_key)
      GM_setValue('dzs_user', dzs.user)
    })

  // First, be polite
  dzs.handshake(function() {

    // Then try scrobbling every 30 seconds
    dzs.try_scrobbling()
    setInterval(dzs.try_scrobbling, 30*1000)

  })

}, false);


// Looped method that finds out the current song and scrobbles
dzs.try_scrobbling = function() {

  // Get the Deezer track from the page title
  var artist = document.title.split(' - ')[1],
      track = document.title.split(' - ')[0];
  if (document.title.match(/Deezer/) || !artist || !track) {
    GM_log("Not scrobbling: no song found");
    return;
  }

  var timestamp = dzs.helpers.utc_timestamp(),
      seconds_since_last_update = timestamp - dzs.last_update

  // cancel if still the same track
  if (artist == dzs.last_artist && track == dzs.last_track) {
    GM_log("Not scrobbling: still the same track");
    return;
  }

  // Scrobble previous track
  if (dzs.last_update && dzs.last_artist && dzs.last_track) {
    dzs.scrobble(dzs.last_artist, dzs.last_track, dzs.last_update)
    dzs.last_artist = artist
    dzs.last_track = track
    dzs.last_update = dzs.helpers.utc_timestamp()
  } else {
    dzs.last_artist = artist
    dzs.last_track = track
    dzs.last_update = dzs.helpers.utc_timestamp()
  }

  // Now playing this track
  dzs.now_playing(artist, track)

}

// Method to make calls to Flickr's 2.0 Web Service
dzs.ws_call = function(args, callback) {
  args.api_sig = dzs.create_api_sig(args)
  var url = 'http://ws.audioscrobbler.com/2.0/?' + dzs.helpers.urlencode(args)
  GM_xmlhttpRequest({
    method: 'GET',
    url: url,
    headers: {
      'Host': 'ws.audioscrobbler.com',
      'User-agent': 'Mozilla/4.0 (compatible) Greasemonkey',
      'Accept': 'application/atom+xml,application/xml,text/xml',
    },
    onload: function(response) { callback(response) }
  })
}

// Method to sign calls sent to last.fm
// as described in http://www.lastfm.fr/api/desktopauth#6
dzs.create_api_sig = function(hash) {
  var sig = '';
  var keys = dzs.helpers.hash_keys(hash).sort()
  for (var i in keys) {
    var key = keys[i]
    sig += key + hash[key]
  }
  return dzs.helpers.md5(sig + dzs.shared_secret)
}

// Fetch a request token
// http://www.lastfm.fr/api/desktopauth#6
dzs.get_token = function(callback) {
  GM_log('Getting token…')
  var args = {
    api_key: dzs.api_key,
    method: 'auth.gettoken',
  }
  dzs.ws_call(args, function(response) {
    var parser = new DOMParser()
    var dom = parser.parseFromString(response.responseText, "application/xml")
    if (dom.getElementsByTagName('lfm')[0].getAttribute('status') == 'ok') {
      dzs.token = dom.getElementsByTagName('token')[0].innerHTML
      GM_log('Got token OK')
      callback.call()
    } else
      GM_log('Error: '+response.responseText)
  })
}

// Fetch a web service session
// as described in http://www.lastfm.fr/api/desktopauth#4
dzs.get_session = function(callback) {
  GM_log('Getting session…')
  var args = {
    api_key: dzs.api_key,
    method: 'auth.getsession',
    token: dzs.token,
  }
  dzs.ws_call(args, function(response) {
    var parser = new DOMParser()
    var dom = parser.parseFromString(response.responseText, "application/xml")
    if (dom.getElementsByTagName('lfm')[0].getAttribute('status') == 'ok') {
      dzs.session_key = dom.getElementsByTagName('key')[0].innerHTML
      dzs.user = dom.getElementsByTagName('name')[0].innerHTML
      GM_log('Got session OK')
      callback.call()
    } else
      GM_log('Error: '+response.responseText)
  })
}

// Handshaking mechanism for last.fm
// See http://www.lastfm.fr/api/submissions#1.4
dzs.handshake = function(callback) {
  GM_log('Handshaking…')
  var timestamp = dzs.helpers.utc_timestamp() // UTC timestamp
  var token = dzs.helpers.md5(dzs.shared_secret + timestamp)

  var args = {
    hs: 'true',
    p: '1.2.1',
    c: dzs.client_id,
    v: dzs.client_version,
    u: dzs.user,
    t: timestamp,
    a: token,
    api_key: dzs.api_key,
    sk: dzs.session_key
  }

  GM_xmlhttpRequest({
    method: 'GET',
    url: 'http://post.audioscrobbler.com/?' + dzs.helpers.urlencode(args), 
    headers: {
      'Host': 'post.audioscrobbler.com',
      'User-agent': 'Mozilla/4.0 (compatible) Greasemonkey',
    },
    onload: function(response) {
      var res = response.responseText.split('\n');
      if (res[0] == 'OK') {
        dzs.session_id = res[1]
        dzs.now_playing_url = res[2]
        dzs.submission_url = res[3]
        GM_log('Handshake OK')
        callback.call()
        return
      }
      GM_log('Error: '+response.responseText);
    }
  })
}


// Submit a "now playing" to last.fm
// See http://www.lastfm.fr/api/submissions#3.2
dzs.now_playing = function(artist, track) {
  GM_log('Now playing: '+artist+' - '+track+'…')

  var post_string = dzs.helpers.urlencode({
    s: dzs.session_id, // given by the handshake
    a: artist,
    t: track,
    b: '', // album title
    l: '', // length of the track
    n: '',  // position of the track on the album
    m: '', // musicbrainz track id
  })

  GM_xmlhttpRequest({
    method: 'POST',
    url: dzs.now_playing_url,
    headers: {
      'User-agent': 'Mozilla/4.0 (compatible) Greasemonkey',
      'Accept': 'application/atom+xml,application/xml,text/xml',
      'Content-Length': post_string.length,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    data: post_string,
    onload: function(response) {
      if (response.responseText.split('\n')[0] == 'OK')
        GM_log('Now playing OK')
      else
        GM_log('Error: '+response.responseText)
    }
  });
}


// Submit a song to last.fm
// See http://www.lastfm.fr/api/submissions#3.2
dzs.scrobble = function(artist, track, play_start_time) {
  GM_log('Scrobbling: '+artist+' - '+track + '…')
  var post_string = dzs.helpers.urlencode({
    's': dzs.session_id, // given by the handshake
    'a[0]': artist,
    't[0]': track,
    'i[0]': play_start_time, // must be in Unix UTC
    'o[0]': 'U',
    'r[0]': '', // rating of the track
    'l[0]': '', // length of the track
    'b[0]': '', // album title
    'n[0]': '', // position of the track on the album
    'm[0]': '', // musicbrainz track id
  })

  GM_xmlhttpRequest({
    method: 'POST',
    url: dzs.submission_url,
    headers: {
      'User-agent': 'Mozilla/4.0 (compatible) Greasemonkey',
      'Accept': 'application/atom+xml,application/xml,text/xml',
      'Content-Length': post_string.length,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    data: post_string,
    onload: function(response) {
      if (response.responseText.split('\n')[0] == 'OK')
        GM_log('Scrobbling OK')
      else
        GM_log('Error: '+response.responseText)
    }
  });
}


/* Helpers */

dzs.helpers = {}

dzs.helpers.utc_timestamp = function() {
  return Math.round(Date.parse((new Date()).toUTCString()) / 1000)
}

// Returns array of keys of a hash
dzs.helpers.hash_keys = function(hash) {
  var keys = [];
  for (var key in hash)
    if (hash.hasOwnProperty(key))
      keys.push(key);
  return keys;
}



// urlencode for hashes
dzs.helpers.urlencode = function(hash) {
  string = ''
  for (key in hash) {
    if (string != '')
      string += '&'
    string += key + '=' + escape(hash[key])
  }
  return string
}

// MD5 digest algorithm via http://www.webtoolkit.info/
dzs.helpers.md5 = function(string) { 
  function RotateLeft(lValue, iShiftBits) {
    return (lValue<<iShiftBits) | (lValue>>>(32-iShiftBits));
  }

  function AddUnsigned(lX,lY) {
    var lX4,lY4,lX8,lY8, lResult;
    lX8 = (lX & 0x80000000);
    lY8 = (lY & 0x80000000);
    lX4 = (lX & 0x40000000);
    lY4 = (lY & 0x40000000);
    lResult = (lX & 0x3FFFFFFF)+(lY & 0x3FFFFFFF);
    if (lX4 & lY4)
      return (lResult ^ 0x80000000 ^ lX8 ^ lY8);

    if (lX4 | lY4) {
      if (lResult & 0x40000000)
        return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
      else
        return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
    } else {
      return (lResult ^ lX8 ^ lY8);
    }
  }

  function F(x,y,z) { return (x & y) | ((~x) & z) }
  function G(x,y,z) { return (x & z) | (y & (~z)) }
  function H(x,y,z) { return (x ^ y ^ z) }
  function I(x,y,z) { return (y ^ (x | (~z))) }

  function FF(a,b,c,d,x,s,ac) {
    a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac));
    return AddUnsigned(RotateLeft(a, s), b);
  }

  function GG(a,b,c,d,x,s,ac) {
    a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac));
    return AddUnsigned(RotateLeft(a, s), b);
  }

  function HH(a,b,c,d,x,s,ac) {
    a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac));
    return AddUnsigned(RotateLeft(a, s), b);
  }

  function II(a,b,c,d,x,s,ac) {
    a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac));
    return AddUnsigned(RotateLeft(a, s), b);
  }

  function ConvertToWordArray(string) {
    var lWordCount,
        lMessageLength = string.length,
        lNumberOfWords_temp1=lMessageLength + 8,
        lNumberOfWords_temp2=(lNumberOfWords_temp1-(lNumberOfWords_temp1 % 64))/64,
        lNumberOfWords = (lNumberOfWords_temp2+1)*16,
        lWordArray=Array(lNumberOfWords-1),
        lBytePosition = 0,
        lByteCount = 0;
    while (lByteCount < lMessageLength) {
      lWordCount = (lByteCount-(lByteCount % 4))/4;
      lBytePosition = (lByteCount % 4)*8;
      lWordArray[lWordCount] = (lWordArray[lWordCount] | (string.charCodeAt(lByteCount)<<lBytePosition));
      lByteCount++;
    }
    lWordCount = (lByteCount-(lByteCount % 4))/4;
    lBytePosition = (lByteCount % 4)*8;
    lWordArray[lWordCount] = lWordArray[lWordCount] | (0x80<<lBytePosition);
    lWordArray[lNumberOfWords-2] = lMessageLength<<3;
    lWordArray[lNumberOfWords-1] = lMessageLength>>>29;
    return lWordArray;
  }

  function WordToHex(lValue) {
    var WordToHexValue = "",
        WordToHexValue_temp = "",
        lByte,
        lCount;
    for (lCount = 0; lCount<=3; lCount++) {
      lByte = (lValue>>>(lCount*8)) & 255;
      WordToHexValue_temp = "0" + lByte.toString(16);
      WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length-2,2);
    }
    return WordToHexValue;
  }

  function Utf8Encode(string) {
    string = string.replace(/\r\n/g,"\n");
    var utftext = "";
    for (var n = 0; n < string.length; n++) {
      var c = string.charCodeAt(n);
      if (c < 128) {
        utftext += String.fromCharCode(c);
      } else if((c > 127) && (c < 2048)) {
        utftext += String.fromCharCode((c >> 6) | 192);
        utftext += String.fromCharCode((c & 63) | 128);
      } else {
        utftext += String.fromCharCode((c >> 12) | 224);
        utftext += String.fromCharCode(((c >> 6) & 63) | 128);
        utftext += String.fromCharCode((c & 63) | 128);
      }
    }
    return utftext;
  }

  string = Utf8Encode(string);
  var x = ConvertToWordArray(string),
      k,AA,BB,CC,DD,
      a = 0x67452301, b = 0xEFCDAB89,
      c = 0x98BADCFE, d = 0x10325476,
      S11=7, S12=12, S13=17, S14=22,
      S21=5, S22=9 , S23=14, S24=20,
      S31=4, S32=11, S33=16, S34=23,
      S41=6, S42=10, S43=15, S44=21;

  for (k=0; k<x.length; k+=16) {
    AA=a; BB=b; CC=c; DD=d;
    a=FF(a,b,c,d,x[k+0], S11,0xD76AA478);
    d=FF(d,a,b,c,x[k+1], S12,0xE8C7B756);
    c=FF(c,d,a,b,x[k+2], S13,0x242070DB);
    b=FF(b,c,d,a,x[k+3], S14,0xC1BDCEEE);
    a=FF(a,b,c,d,x[k+4], S11,0xF57C0FAF);
    d=FF(d,a,b,c,x[k+5], S12,0x4787C62A);
    c=FF(c,d,a,b,x[k+6], S13,0xA8304613);
    b=FF(b,c,d,a,x[k+7], S14,0xFD469501);
    a=FF(a,b,c,d,x[k+8], S11,0x698098D8);
    d=FF(d,a,b,c,x[k+9], S12,0x8B44F7AF);
    c=FF(c,d,a,b,x[k+10],S13,0xFFFF5BB1);
    b=FF(b,c,d,a,x[k+11],S14,0x895CD7BE);
    a=FF(a,b,c,d,x[k+12],S11,0x6B901122);
    d=FF(d,a,b,c,x[k+13],S12,0xFD987193);
    c=FF(c,d,a,b,x[k+14],S13,0xA679438E);
    b=FF(b,c,d,a,x[k+15],S14,0x49B40821);
    a=GG(a,b,c,d,x[k+1], S21,0xF61E2562);
    d=GG(d,a,b,c,x[k+6], S22,0xC040B340);
    c=GG(c,d,a,b,x[k+11],S23,0x265E5A51);
    b=GG(b,c,d,a,x[k+0], S24,0xE9B6C7AA);
    a=GG(a,b,c,d,x[k+5], S21,0xD62F105D);
    d=GG(d,a,b,c,x[k+10],S22,0x2441453);
    c=GG(c,d,a,b,x[k+15],S23,0xD8A1E681);
    b=GG(b,c,d,a,x[k+4], S24,0xE7D3FBC8);
    a=GG(a,b,c,d,x[k+9], S21,0x21E1CDE6);
    d=GG(d,a,b,c,x[k+14],S22,0xC33707D6);
    c=GG(c,d,a,b,x[k+3], S23,0xF4D50D87);
    b=GG(b,c,d,a,x[k+8], S24,0x455A14ED);
    a=GG(a,b,c,d,x[k+13],S21,0xA9E3E905);
    d=GG(d,a,b,c,x[k+2], S22,0xFCEFA3F8);
    c=GG(c,d,a,b,x[k+7], S23,0x676F02D9);
    b=GG(b,c,d,a,x[k+12],S24,0x8D2A4C8A);
    a=HH(a,b,c,d,x[k+5], S31,0xFFFA3942);
    d=HH(d,a,b,c,x[k+8], S32,0x8771F681);
    c=HH(c,d,a,b,x[k+11],S33,0x6D9D6122);
    b=HH(b,c,d,a,x[k+14],S34,0xFDE5380C);
    a=HH(a,b,c,d,x[k+1], S31,0xA4BEEA44);
    d=HH(d,a,b,c,x[k+4], S32,0x4BDECFA9);
    c=HH(c,d,a,b,x[k+7], S33,0xF6BB4B60);
    b=HH(b,c,d,a,x[k+10],S34,0xBEBFBC70);
    a=HH(a,b,c,d,x[k+13],S31,0x289B7EC6);
    d=HH(d,a,b,c,x[k+0], S32,0xEAA127FA);
    c=HH(c,d,a,b,x[k+3], S33,0xD4EF3085);
    b=HH(b,c,d,a,x[k+6], S34,0x4881D05);
    a=HH(a,b,c,d,x[k+9], S31,0xD9D4D039);
    d=HH(d,a,b,c,x[k+12],S32,0xE6DB99E5);
    c=HH(c,d,a,b,x[k+15],S33,0x1FA27CF8);
    b=HH(b,c,d,a,x[k+2], S34,0xC4AC5665);
    a=II(a,b,c,d,x[k+0], S41,0xF4292244);
    d=II(d,a,b,c,x[k+7], S42,0x432AFF97);
    c=II(c,d,a,b,x[k+14],S43,0xAB9423A7);
    b=II(b,c,d,a,x[k+5], S44,0xFC93A039);
    a=II(a,b,c,d,x[k+12],S41,0x655B59C3);
    d=II(d,a,b,c,x[k+3], S42,0x8F0CCC92);
    c=II(c,d,a,b,x[k+10],S43,0xFFEFF47D);
    b=II(b,c,d,a,x[k+1], S44,0x85845DD1);
    a=II(a,b,c,d,x[k+8], S41,0x6FA87E4F);
    d=II(d,a,b,c,x[k+15],S42,0xFE2CE6E0);
    c=II(c,d,a,b,x[k+6], S43,0xA3014314);
    b=II(b,c,d,a,x[k+13],S44,0x4E0811A1);
    a=II(a,b,c,d,x[k+4], S41,0xF7537E82);
    d=II(d,a,b,c,x[k+11],S42,0xBD3AF235);
    c=II(c,d,a,b,x[k+2], S43,0x2AD7D2BB);
    b=II(b,c,d,a,x[k+9], S44,0xEB86D391);
    a=AddUnsigned(a,AA);
    b=AddUnsigned(b,BB);
    c=AddUnsigned(c,CC);
    d=AddUnsigned(d,DD);
  }

  var temp = WordToHex(a)+WordToHex(b)+WordToHex(c)+WordToHex(d);

  return temp.toLowerCase();
}


