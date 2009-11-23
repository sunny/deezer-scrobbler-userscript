// ==UserScript==
// @name          Deezer Scrobbler
// @namespace     http://github.com/sunny/deezer-scrobbler-userscript
// @description   Scrobbles the currently playing title in deezer to last.fm
// @include       http://www.deezer.com/*
// ==/UserScript==

as = {}

// Lastfm API vars
as.user = GM_getValue('as_user')
as.token = GM_getValue('as_token')
as.session_key = GM_getValue('as_session_key')
as.api_key = '2f4a8d27f538fc7bd5a772a9f311197f'
as.shared_secret = '14e2dfb03533fb08b0aa59020e7a0bb1'
as.client_id = 'tst' // for test only
as.client_version = '1.0'
as.now_playing_url = null
as.submission_url = null
as.session_id = null

// Deezer Scrobbler vars
as.last_update = null
as.last_artist = null
as.last_track = null

// Go !
window.addEventListener('load', function() {
  as.log('Token: ' + as.token)
  as.log('User: ' + as.user)
  as.log('Session key: ' + as.session_key)

  // No token? Get one, then redirect the user to authorize app
  if (!as.token)
    return as.get_token(function() {
      GM_setValue('as_token', as.token)
      var url = 'http://www.last.fm/api/auth/?api_key='+as.api_key+'&token='+as.token
      alert("Pour utiliser Deezer Scrobbler vous devez accepter l'application dans last.fm. Quand vous cliquerez sur OK une page last.fm s'ouvrira qui vous permettra d'autoriser Deezer Scrobbler à scrobbler à votre place. Une fois accepté merci de recharger Deezer.")
      window.open(url)
    })

  // No session key? Get one with the user name as well
  if (!as.session_key)
    as.get_session(function() {
      GM_setValue('as_session_key', as.session_key)
      GM_setValue('as_user', as.user)
      as.log('Got session!')
    })

  // First, be polite
  as.handshake(function() {

    // Then try scrobbling every 30 seconds
    as.try_scrobbling()
    setInterval(as.try_scrobbling, 30*1000)

  })

}, false);


// Looped method that finds out the current song and scrobbles
as.try_scrobbling = function() {
  as.log("Checking the need to scrobble…")

  // Get the Deezer track from the page title
  var artist = document.title.split(' - ')[1],
      track = document.title.split(' - ')[0];
  if (document.title.match(/Deezer/) || !artist || !track)
    return;

  var timestamp = as.helpers.utc_timestamp(),
      seconds_since_last_update = timestamp - as.last_update

  // cancel if still the same track
  if (artist == as.last_artist && track == as.last_track)
    return;

  // Scrobble previous track
  if (as.last_update && as.last_artist && as.last_track) {
    as.scrobble(as.last_artist, as.last_track, as.last_update)
    as.last_artist = artist
    as.last_track = track
    as.last_update = as.helpers.utc_timestamp()
  } else {
    as.last_artist = artist
    as.last_track = track
    as.last_update = as.helpers.utc_timestamp()
  }

  // Now playing this track
  as.now_playing(artist, track)

}

// Method to make calls to Flickr's 2.0 Web Service
as.ws_call = function(args, callback) {
  args.api_sig = as.create_api_sig(args)
  var url = 'http://ws.audioscrobbler.com/2.0/?' + as.helpers.urlencode(args)
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
as.create_api_sig = function(hash) {
  var sig = '';
  var keys = as.helpers.hash_keys(hash).sort()
  for (var i in keys) {
    var key = keys[i]
    sig += key + hash[key]
  }
  return as.helpers.md5(sig + as.shared_secret)
}

// Fetch a request token
// http://www.lastfm.fr/api/desktopauth#6
as.get_token = function(callback) {
  as.log('Getting token…')
  var args = {
    api_key: as.api_key,
    method: 'auth.gettoken',
  }
  as.ws_call(args, function(response) {
    var node = document.createElement('div')
    node.innerHTML = response.responseText
    if (node.getElementsByTagName('lfm')[0].getAttribute('status') == 'ok') {
      as.token = node.getElementsByTagName('token')[0].innerHTML
      as.log('Found token '+as.token)
      callback.call()
    } else
      as.log('Error: '+response.responseText)
  })
}

// Fetch a web service session
// as described in http://www.lastfm.fr/api/desktopauth#4
as.get_session = function(callback) {
  var args = {
    api_key: as.api_key,
    method: 'auth.getsession',
    token: as.token,
  }
  as.ws_call(args, function(response) {
    var node = document.createElement('div')
    node.innerHTML = response.responseText
    if (node.getElementsByTagName('lfm')[0].getAttribute('status') == 'ok') {
      as.session_key = node.getElementsByTagName('key')[0].innerHTML
      as.user = node.getElementsByTagName('name')[0].innerHTML
      as.log('Found session '+as.session_key)
      callback.call()
    } else
      as.log('Error: '+response.responseText)
  })
}

// Handshaking mechanism for last.fm
// See http://www.lastfm.fr/api/submissions#1.4
as.handshake = function(callback) {
  as.log('Handshaking…')
  var timestamp = as.helpers.utc_timestamp() // UTC timestamp
  var token = as.helpers.md5(as.shared_secret + timestamp)

  var args = {
    hs: 'true',
    p: '1.2.1',
    c: as.client_id,
    v: as.client_version,
    u: as.user,
    t: timestamp,
    a: token,
    api_key: as.api_key,
    sk: as.session_key
  }

  GM_xmlhttpRequest({
    method: 'GET',
    url: 'http://post.audioscrobbler.com/?' + as.helpers.urlencode(args), 
    headers: {
      'Host': 'post.audioscrobbler.com',
      'User-agent': 'Mozilla/4.0 (compatible) Greasemonkey',
    },
    onload: function(response) {
      var res = response.responseText.split('\n');
      if (res[0] == 'OK') {
        as.log('Handshake OK!')
        as.session_id = res[1]
        as.now_playing_url = res[2]
        as.submission_url = res[3]
        callback.call()
        return
      }
      as.log('Error: '+response.responseText);
    }
  })
}


// Submit a "now playing" to last.fm
// See http://www.lastfm.fr/api/submissions#3.2
as.now_playing = function(artist, track) {
  as.log('Now playing: '+artist+' - '+track+'…')

  var post_string = as.helpers.urlencode({
    s: as.session_id, // given by the handshake
    a: artist,
    t: track,
    b: '', // album title
    l: '', // length of the track
    n: '',  // position of the track on the album
    m: '', // musicbrainz track id
  })

  GM_xmlhttpRequest({
    method: 'POST',
    url: as.now_playing_url,
    headers: {
      'User-agent': 'Mozilla/4.0 (compatible) Greasemonkey',
      'Accept': 'application/atom+xml,application/xml,text/xml',
      'Content-Length': post_string.length,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    data: post_string,
    onload: function(response) {
      if (response.responseText.split('\n')[0] == 'OK')
        as.log('Added now playing!')
      else
        as.log('Error: '+response.responseText)
    }
  });
}


// Submit a song to last.fm
// See http://www.lastfm.fr/api/submissions#3.2
as.scrobble = function(artist, track, play_start_time) {
  as.log('Scrobbling: '+artist+' - '+track + '…')

  var post_string = as.helpers.urlencode({
    's': as.session_id, // given by the handshake
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
    url: as.submission_url,
    headers: {
      'User-agent': 'Mozilla/4.0 (compatible) Greasemonkey',
      'Accept': 'application/atom+xml,application/xml,text/xml',
      'Content-Length': post_string.length,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    data: post_string,
    onload: function(response) {
      if (response.responseText.split('\n')[0] == 'OK')
        as.log('Scrobbled!')
      else
        as.log('Error: '+response.responseText)
    }
  });
}


// Logger
as.log = function(line) {
  if (console && console.info) console.info('AS:', line)
}


/* Helpers */

as.helpers = {}

as.helpers.utc_timestamp = function() {
  return Math.round(Date.parse((new Date()).toUTCString()) / 1000)
}

// Returns array of keys of a hash
as.helpers.hash_keys = function(hash) {
  var keys = [];
  for (var key in hash)
    if (hash.hasOwnProperty(key))
      keys.push(key);
  return keys;
}



// urlencode for hashes
as.helpers.urlencode = function(hash) {
  string = ''
  for (key in hash) {
    if (string != '')
      string += '&'
    string += key + '=' + escape(hash[key])
  }
  return string
}

// MD5 digest algorithm via http://www.webtoolkit.info/
as.helpers.md5 = function (string) { 
  function RotateLeft(lValue, iShiftBits) {
          return (lValue<<iShiftBits) | (lValue>>>(32-iShiftBits));
  }

  function AddUnsigned(lX,lY) {
          var lX4,lY4,lX8,lY8,lResult;
          lX8 = (lX & 0x80000000);
          lY8 = (lY & 0x80000000);
          lX4 = (lX & 0x40000000);
          lY4 = (lY & 0x40000000);
          lResult = (lX & 0x3FFFFFFF)+(lY & 0x3FFFFFFF);
          if (lX4 & lY4) {
                  return (lResult ^ 0x80000000 ^ lX8 ^ lY8);
          }
          if (lX4 | lY4) {
                  if (lResult & 0x40000000) {
                          return (lResult ^ 0xC0000000 ^ lX8 ^ lY8);
                  } else {
                          return (lResult ^ 0x40000000 ^ lX8 ^ lY8);
                  }
          } else {
                  return (lResult ^ lX8 ^ lY8);
          }
   }

   function F(x,y,z) { return (x & y) | ((~x) & z); }
   function G(x,y,z) { return (x & z) | (y & (~z)); }
   function H(x,y,z) { return (x ^ y ^ z); }
  function I(x,y,z) { return (y ^ (x | (~z))); }

  function FF(a,b,c,d,x,s,ac) {
          a = AddUnsigned(a, AddUnsigned(AddUnsigned(F(b, c, d), x), ac));
          return AddUnsigned(RotateLeft(a, s), b);
  };

  function GG(a,b,c,d,x,s,ac) {
          a = AddUnsigned(a, AddUnsigned(AddUnsigned(G(b, c, d), x), ac));
          return AddUnsigned(RotateLeft(a, s), b);
  };

  function HH(a,b,c,d,x,s,ac) {
          a = AddUnsigned(a, AddUnsigned(AddUnsigned(H(b, c, d), x), ac));
          return AddUnsigned(RotateLeft(a, s), b);
  };

  function II(a,b,c,d,x,s,ac) {
          a = AddUnsigned(a, AddUnsigned(AddUnsigned(I(b, c, d), x), ac));
          return AddUnsigned(RotateLeft(a, s), b);
  };

  function ConvertToWordArray(string) {
          var lWordCount;
          var lMessageLength = string.length;
          var lNumberOfWords_temp1=lMessageLength + 8;
          var lNumberOfWords_temp2=(lNumberOfWords_temp1-(lNumberOfWords_temp1 % 64))/64;
          var lNumberOfWords = (lNumberOfWords_temp2+1)*16;
          var lWordArray=Array(lNumberOfWords-1);
          var lBytePosition = 0;
          var lByteCount = 0;
          while ( lByteCount < lMessageLength ) {
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
  };

  function WordToHex(lValue) {
          var WordToHexValue="",WordToHexValue_temp="",lByte,lCount;
          for (lCount = 0;lCount<=3;lCount++) {
                  lByte = (lValue>>>(lCount*8)) & 255;
                  WordToHexValue_temp = "0" + lByte.toString(16);
                  WordToHexValue = WordToHexValue + WordToHexValue_temp.substr(WordToHexValue_temp.length-2,2);
          }
          return WordToHexValue;
  };

  function Utf8Encode(string) {
          string = string.replace(/\r\n/g,"\n");
          var utftext = "";

          for (var n = 0; n < string.length; n++) {

                  var c = string.charCodeAt(n);

                  if (c < 128) {
                          utftext += String.fromCharCode(c);
                  }
                  else if((c > 127) && (c < 2048)) {
                          utftext += String.fromCharCode((c >> 6) | 192);
                          utftext += String.fromCharCode((c & 63) | 128);
                  }
                  else {
                          utftext += String.fromCharCode((c >> 12) | 224);
                          utftext += String.fromCharCode(((c >> 6) & 63) | 128);
                          utftext += String.fromCharCode((c & 63) | 128);

                  }

          }

          return utftext;
  };

  var x=Array();
  var k,AA,BB,CC,DD,a,b,c,d;
  var S11=7, S12=12, S13=17, S14=22;
  var S21=5, S22=9 , S23=14, S24=20;
  var S31=4, S32=11, S33=16, S34=23;
  var S41=6, S42=10, S43=15, S44=21;

  string = Utf8Encode(string);

  x = ConvertToWordArray(string);

  a = 0x67452301; b = 0xEFCDAB89; c = 0x98BADCFE; d = 0x10325476;

  for (k=0;k<x.length;k+=16) {
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


as.log('Loaded')

