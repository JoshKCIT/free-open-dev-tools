// Recorded by tools/totp-generator/test/fixtures/make-fixtures.py with pyotp 2.10.0 (see README.md). Do not edit by hand.

export interface TotpCase { seedHex: string; seedB32: string; algorithm: 'SHA1' | 'SHA256' | 'SHA512'; digits: 6 | 7 | 8; period: number; seconds: number; code: string }
export interface HotpCase { seedHex: string; algorithm: 'SHA1' | 'SHA256' | 'SHA512'; digits: 6 | 7 | 8; counter: string; code: string }
export interface LinkCase { title: string; seedHex: string; options: { type: 'totp' | 'hotp'; issuer: string; account: string; algorithm: 'SHA1' | 'SHA256' | 'SHA512'; digits: 6 | 7 | 8; period: number; counter: string }; uri: string }

export const PYOTP_VERSION = "2.10.0";
export const TOTP_CASES: TotpCase[] = [
  {
    "seedHex": "695e2a808e89517516dba2640ffdaed37ee1ede60db13c2f098c25175f15",
    "seedB32": "NFPCVAEORFIXKFW3UJSA77NO2N7OD3PGBWYTYLYJRQSROXYV",
    "algorithm": "SHA512",
    "digits": 7,
    "period": 60,
    "seconds": 3588275672,
    "code": "7236417"
  },
  {
    "seedHex": "0b060d13a8978c9c65d808b90e95c2951c3861d06b3b774714e934e1f437bd612c755ff5840c9a",
    "seedB32": "BMDA2E5IS6GJYZOYBC4Q5FOCSUODQYOQNM5XORYU5E2OD5BXXVQSY5K76WCAZGQ",
    "algorithm": "SHA512",
    "digits": 7,
    "period": 15,
    "seconds": 430596586,
    "code": "3780182"
  },
  {
    "seedHex": "820b02c66533868448c63c9d590c8dfaa1eaab742b5b091b864b06e5c2629e634f74a0fc71",
    "seedB32": "QIFQFRTFGODIISGGHSOVSDEN7KQ6VK3UFNNQSG4GJMDOLQTCTZRU65FA7RYQ",
    "algorithm": "SHA1",
    "digits": 8,
    "period": 30,
    "seconds": 322952605,
    "code": "37569941"
  },
  {
    "seedHex": "b28cd4929a4c2de115603599af9b9dc1ed",
    "seedB32": "WKGNJEU2JQW6CFLAGWM27G45YHWQ",
    "algorithm": "SHA256",
    "digits": 6,
    "period": 15,
    "seconds": 1776395689,
    "code": "361975"
  },
  {
    "seedHex": "3a622310d803e62ea99727e136dba4b76e096b78b16ff0109b78fff98373aa27b15cc3de",
    "seedB32": "HJRCGEGYAPTC5KMXE7QTNW5EW5XAS23YWFX7AEE3PD77TA3TVIT3CXGD3Y",
    "algorithm": "SHA256",
    "digits": 6,
    "period": 15,
    "seconds": 2929641349,
    "code": "555373"
  },
  {
    "seedHex": "00b2a620a0d9ba3ef8ad514679dfef548bf73618be731c1ffa9aad92481abf09fe6592ce30b9eb7397e94db8",
    "seedB32": "ACZKMIFA3G5D56FNKFDHTX7PKSF7ONQYXZZRYH72TKWZESA2X4E74ZMSZYYLT23TS7UU3OA",
    "algorithm": "SHA1",
    "digits": 7,
    "period": 15,
    "seconds": 1987807986,
    "code": "5919924"
  },
  {
    "seedHex": "8d350192924813ecbace6591845ea0b19a9c3ebc7017136a65fc",
    "seedB32": "RU2QDEUSJAJ6ZOWOMWIYIXVAWGNJYPV4OALRG2TF7Q",
    "algorithm": "SHA1",
    "digits": 6,
    "period": 15,
    "seconds": 2658403187,
    "code": "365538"
  },
  {
    "seedHex": "c729d2c0828e20f8062d8bc2c56c097d22f3697571765bb8b0c6408c",
    "seedB32": "Y4U5FQECRYQPQBRNRPBMK3AJPURPG2LVOF3FXOFQYZAIY",
    "algorithm": "SHA256",
    "digits": 7,
    "period": 60,
    "seconds": 2733894215,
    "code": "4860637"
  },
  {
    "seedHex": "f896df9c27f815ebb43ec1bde065c576a7f5a5b7b47f1e60973c5812b91af2002858cc51eb",
    "seedB32": "7CLN7HBH7AK6XNB6YG66AZOFO2T7LJNXWR7R4YEXHRMBFOI26IACQWGMKHVQ",
    "algorithm": "SHA256",
    "digits": 8,
    "period": 15,
    "seconds": 1673893914,
    "code": "85156708"
  },
  {
    "seedHex": "95d9cea0bc44b8f9e0fbfc85a39e5681d69b",
    "seedB32": "SXM45IF4IS4PTYH37SC2HHSWQHLJW",
    "algorithm": "SHA1",
    "digits": 6,
    "period": 30,
    "seconds": 3597338051,
    "code": "025295"
  },
  {
    "seedHex": "c97813797e41139240c4032ff7",
    "seedB32": "ZF4BG6L6IEJZEQGEAMX7O",
    "algorithm": "SHA1",
    "digits": 7,
    "period": 60,
    "seconds": 3067098580,
    "code": "5275339"
  },
  {
    "seedHex": "23cf488a45228d1a7a8e9e2aff80f934ef05db2b0a",
    "seedB32": "EPHURCSFEKGRU6UOTYVP7AHZGTXQLWZLBI",
    "algorithm": "SHA256",
    "digits": 7,
    "period": 15,
    "seconds": 175075477,
    "code": "8642617"
  },
  {
    "seedHex": "944974a146b26c896cec",
    "seedB32": "SREXJIKGWJWIS3HM",
    "algorithm": "SHA1",
    "digits": 6,
    "period": 30,
    "seconds": 2630095437,
    "code": "223732"
  },
  {
    "seedHex": "efe59dbbfcf2253259f186d0e1812d841477d265e570e3aef912d00b003afdb7631ee578713fc1c8f046d03b1266e6",
    "seedB32": "57SZ3O746ISTEWPRQ3IODAJNQQKHPUTF4VYOHLXZCLIAWAB27W3WGHXFPBYT7QOI6BDNAOYSM3TA",
    "algorithm": "SHA512",
    "digits": 6,
    "period": 60,
    "seconds": 2909702795,
    "code": "522291"
  },
  {
    "seedHex": "5aaf4bda7b213c6daeae88b0aa78ea8a5b68103e8544a3f3c8",
    "seedB32": "LKXUXWT3EE6G3LVORCYKU6HKRJNWQEB6QVCKH46I",
    "algorithm": "SHA512",
    "digits": 6,
    "period": 30,
    "seconds": 1040198384,
    "code": "923176"
  },
  {
    "seedHex": "47e67b7c0d847cdf68538ff7e22008ac50b6fc543f9dd6f0f8dba958d454",
    "seedB32": "I7THW7ANQR6N62CTR736EIAIVRILN7CUH6O5N4HY3OUVRVCU",
    "algorithm": "SHA256",
    "digits": 6,
    "period": 30,
    "seconds": 55719652,
    "code": "979837"
  },
  {
    "seedHex": "78de0a6ba053873c51410c4a0d0121139d0c18ab3f8242",
    "seedB32": "PDPAU25AKODTYUKBBRFA2AJBCOOQYGFLH6BEE",
    "algorithm": "SHA256",
    "digits": 7,
    "period": 60,
    "seconds": 3013398463,
    "code": "5004405"
  },
  {
    "seedHex": "8e7dc0611cabf7efea4db9c1bba6be4cd406753d4d339f9bca9bf95382551cd03d05ff02",
    "seedB32": "RZ64AYI4VP3672SNXHA3XJV6JTKAM5J5JUZZ7G6KTP4VHASVDTID2BP7AI",
    "algorithm": "SHA256",
    "digits": 6,
    "period": 30,
    "seconds": 3880357140,
    "code": "136626"
  },
  {
    "seedHex": "a60a26254659a3dcb8b5213a43c83617dde274e0bf05ec3a846b3e488d5ffb6b324bb23b1eb10dca",
    "seedB32": "UYFCMJKGLGR5ZOFVEE5EHSBWC7O6E5HAX4C6YOUENM7ERDK77NVTES5SHMPLCDOK",
    "algorithm": "SHA512",
    "digits": 7,
    "period": 15,
    "seconds": 134014857,
    "code": "9321955"
  },
  {
    "seedHex": "5aba133f8d88d1d3f8dc818bcccd862de18b53515b6137ffe36e7aae3c9b972d509480ff5527d7cd0d83a4ac33bd68",
    "seedB32": "LK5BGP4NRDI5H6G4QGF4ZTMGFXQYWU2RLNQTP77DNZ5K4PE3S4WVBFEA75KSPV6NBWB2JLBTXVUA",
    "algorithm": "SHA256",
    "digits": 6,
    "period": 15,
    "seconds": 1130046717,
    "code": "754896"
  },
  {
    "seedHex": "f45fc95f484d24c358ab0f2c8e9f8696ec734e68cd5256ae3fc8526199e27792e3",
    "seedB32": "6RP4SX2IJUSMGWFLB4WI5H4GS3WHGTTIZVJFNLR7ZBJGDGPCO6JOG",
    "algorithm": "SHA512",
    "digits": 6,
    "period": 60,
    "seconds": 2450940685,
    "code": "361815"
  },
  {
    "seedHex": "31de70260543538d2b47438abca74e2742a8f59ee00ded8ab58e71f9d4c9cfbad93d79a47c46",
    "seedB32": "GHPHAJQFINJY2K2HIOFLZJ2OE5BKR5M64AG63CVVRZY7TVGJZ65NSPLZUR6EM",
    "algorithm": "SHA512",
    "digits": 6,
    "period": 15,
    "seconds": 3688232579,
    "code": "490502"
  },
  {
    "seedHex": "52b7b7b5624200917992ba9f098dacebfb22f0ac6924ea6e9858430b6b003f99b90b80bfb1",
    "seedB32": "KK33PNLCIIAJC6MSXKPQTDNM5P5SF4FMNESOU3UYLBBQW2YAH6M3SC4AX6YQ",
    "algorithm": "SHA256",
    "digits": 8,
    "period": 30,
    "seconds": 3122735011,
    "code": "20935402"
  },
  {
    "seedHex": "7a6311d369ec1abba8bacaf4eed980fd",
    "seedB32": "PJRRDU3J5QNLXKF2ZL2O5WMA7U",
    "algorithm": "SHA256",
    "digits": 6,
    "period": 60,
    "seconds": 1549330266,
    "code": "987001"
  },
  {
    "seedHex": "a962290e2a0ee719368f0258b959de6e69d727647958c855c4bb171861689d74a39c7792b9c2b3",
    "seedB32": "VFRCSDRKB3TRSNUPAJMLSWO6NZU5OJ3EPFMMQVOEXMLRQYLITV2KHHDXSK44FMY",
    "algorithm": "SHA1",
    "digits": 6,
    "period": 15,
    "seconds": 3546024201,
    "code": "837233"
  },
  {
    "seedHex": "d36d597eb1e48a1216b577fa",
    "seedB32": "2NWVS7VR4SFBEFVVO75A",
    "algorithm": "SHA512",
    "digits": 8,
    "period": 15,
    "seconds": 3277734501,
    "code": "77089098"
  },
  {
    "seedHex": "7f7f7460d3286c9541151e418272bed8",
    "seedB32": "P57XIYGTFBWJKQIVDZAYE4V63A",
    "algorithm": "SHA512",
    "digits": 7,
    "period": 60,
    "seconds": 3699072726,
    "code": "0697563"
  },
  {
    "seedHex": "744af4008925be08df08559596d46d53729d1fe8aadee34ce87d221f5ac9650326bb922c1baa2a3a11",
    "seedB32": "ORFPIAEJEW7ARXYIKWKZNVDNKNZJ2H7IVLPOGTHIPURB6WWJMUBSNO4SFQN2UKR2CE",
    "algorithm": "SHA1",
    "digits": 8,
    "period": 15,
    "seconds": 168899803,
    "code": "15453941"
  },
  {
    "seedHex": "2ee157742e604a598b5d786fe9b7bcdeb1845fc55eb73f4f2f1dad5e",
    "seedB32": "F3QVO5BOMBFFTC25PBX6TN5432YYIX6FL23T6TZPDWWV4",
    "algorithm": "SHA256",
    "digits": 6,
    "period": 15,
    "seconds": 2544384158,
    "code": "784615"
  },
  {
    "seedHex": "30986692a9217cbd6539cd2762fb3a309244c09b7f50d7d4dba2fe36f4ecc06e89ee686474f9845cdf63f5e6286a9d5a",
    "seedB32": "GCMGNEVJEF6L2ZJZZUTWF6Z2GCJEJQE3P5INPVG3UL7DN5HMYBXIT3TIMR2PTBC435R7LZRINKOVU",
    "algorithm": "SHA1",
    "digits": 6,
    "period": 60,
    "seconds": 3153197331,
    "code": "404461"
  },
  {
    "seedHex": "4dddfb94ad4f20d147d1f8e1c4870e26d253dd6f8cae0ffec4fc6dc19c049479faa1b49a",
    "seedB32": "JXO7XFFNJ4QNCR6R7DQ4JBYOE3JFHXLPRSXA77WE7RW4DHAESR47VINUTI",
    "algorithm": "SHA256",
    "digits": 8,
    "period": 15,
    "seconds": 2722476661,
    "code": "50603228"
  },
  {
    "seedHex": "08500da194cbcb84ff33623f30296932bd16bd5dcba469e866b55ce9",
    "seedB32": "BBIA3IMUZPFYJ7ZTMI7TAKLJGK6RNPK5ZOSGT2DGWVOOS",
    "algorithm": "SHA1",
    "digits": 7,
    "period": 15,
    "seconds": 2549102927,
    "code": "8795131"
  },
  {
    "seedHex": "b1f85a24ab124c8e836b12468ae113ba27655a1aed79ecd9",
    "seedB32": "WH4FUJFLCJGI5A3LCJDIVYITXITWKWQ25V46ZWI",
    "algorithm": "SHA1",
    "digits": 8,
    "period": 30,
    "seconds": 3110391096,
    "code": "79456447"
  },
  {
    "seedHex": "79fe316ca0078d1d9dcc6c9fe66b6f728e",
    "seedB32": "PH7DC3FAA6GR3HOMNSP6M23POKHA",
    "algorithm": "SHA256",
    "digits": 7,
    "period": 15,
    "seconds": 2152133201,
    "code": "1309649"
  },
  {
    "seedHex": "8756a9626ef45b747bfeb11ac3795b4f9b75d0d67fca0009a7e7b9bbe95c23022816f7466d1c208ef7cf36d0700b0d51",
    "seedB32": "Q5LKSYTO6RNXI676WENMG6K3J6NXLUGWP7FAACNH4643X2K4EMBCQFXXIZWRYIEO67HTNUDQBMGVC",
    "algorithm": "SHA512",
    "digits": 7,
    "period": 60,
    "seconds": 3982656958,
    "code": "0705236"
  },
  {
    "seedHex": "470fed734b4a389c85e44da234",
    "seedB32": "I4H6242LJI4JZBPEJWRDI",
    "algorithm": "SHA512",
    "digits": 8,
    "period": 30,
    "seconds": 3928926868,
    "code": "05406979"
  },
  {
    "seedHex": "e8c0d3f9fca23cef075f5a62594fe78bb5adc59a5a023b07b3832cdfbe259ae1f780046fc4bf6f8bbfaf0f0637cb6dc906",
    "seedB32": "5DANH6P4UI6O6B27LJRFST7HRO223RM2LIBDWB5TQMWN7PRFTLQ7PAAEN7CL634LX6XQ6BRXZNW4SBQ",
    "algorithm": "SHA256",
    "digits": 8,
    "period": 30,
    "seconds": 736930750,
    "code": "46990217"
  },
  {
    "seedHex": "70a08204c4e7e21164c38941198b70",
    "seedB32": "OCQIEBGE47RBCZGDRFARTC3Q",
    "algorithm": "SHA1",
    "digits": 7,
    "period": 60,
    "seconds": 2735651721,
    "code": "8121034"
  },
  {
    "seedHex": "a2a9e032e9c0c8cab13a3e0198f1437269481e9d691e20def486e5342b84f3a2e861e6",
    "seedB32": "UKU6AMXJYDEMVMJ2HYAZR4KDOJUUQHU5NEPCBXXUQ3STIK4E6OROQYPG",
    "algorithm": "SHA512",
    "digits": 8,
    "period": 60,
    "seconds": 277070420,
    "code": "65997194"
  },
  {
    "seedHex": "027a89df0ead1fd5ce9e7e3260",
    "seedB32": "AJ5ITXYOVUP5LTU6PYZGA",
    "algorithm": "SHA256",
    "digits": 7,
    "period": 30,
    "seconds": 2155786114,
    "code": "1293989"
  },
  {
    "seedHex": "5c0957d211cd9601952a91c92a2747e5d30e08b35957ea0d8435",
    "seedB32": "LQEVPUQRZWLADFJKSHESUJ2H4XJQ4CFTLFL6UDMEGU",
    "algorithm": "SHA512",
    "digits": 7,
    "period": 15,
    "seconds": 2723868743,
    "code": "8635184"
  },
  {
    "seedHex": "a50ab1b0be4441601930f81ba6317930d98a7ba016857ea30c8975471a449e6622267bf9c3c49a",
    "seedB32": "UUFLDMF6IRAWAGJQ7AN2MMLZGDMYU65AC2CX5IYMRF2UOGSETZTCEJT37HB4JGQ",
    "algorithm": "SHA1",
    "digits": 6,
    "period": 15,
    "seconds": 1544709300,
    "code": "262602"
  },
  {
    "seedHex": "baeb8991b92642f8fb2c1334bd9b0aee74bc390ff68166ce1bf0d65c62e5f2add9c95f7cdc4855fe53f8df642d13602b",
    "seedB32": "XLVYTENZEZBPR6ZMCM2L3GYK5Z2LYOIP62AWNTQ36DLFYYXF6KW5TSK7PTOEQVP6KP4N6ZBNCNQCW",
    "algorithm": "SHA256",
    "digits": 7,
    "period": 60,
    "seconds": 2124432867,
    "code": "9120076"
  },
  {
    "seedHex": "ed84e395617d5573e01e8ee9d25820817ec563554f67b0880fb5e47efbf3289b50073b8e146247b6",
    "seedB32": "5WCOHFLBPVKXHYA6R3U5EWBAQF7MKY2VJ5T3BCAPWXSH567TFCNVABZ3RYKGER5W",
    "algorithm": "SHA1",
    "digits": 6,
    "period": 60,
    "seconds": 3047765004,
    "code": "980678"
  },
  {
    "seedHex": "e9e20bd4cf492d7b77b86b6d3632042c6db50fa49f95",
    "seedB32": "5HRAXVGPJEWXW55YNNWTMMQEFRW3KD5ET6KQ",
    "algorithm": "SHA1",
    "digits": 6,
    "period": 15,
    "seconds": 3164005977,
    "code": "241876"
  },
  {
    "seedHex": "166fbbd2d2b4a844aff9303d765ee336bee41faed742ba2dbc",
    "seedB32": "CZX3XUWSWSUEJL7ZGA6XMXXDG27OIH5O25BLULN4",
    "algorithm": "SHA512",
    "digits": 6,
    "period": 30,
    "seconds": 2267269461,
    "code": "089452"
  },
  {
    "seedHex": "f889058bb864d2862ea6dad4f8f18792f94a7ec7094ee1fcf5c6f5acd14b0d11db38fbb4",
    "seedB32": "7CEQLC5YMTJIMLVG3LKPR4MHSL4UU7WHBFHOD7HVY322ZUKLBUI5WOH3WQ",
    "algorithm": "SHA1",
    "digits": 8,
    "period": 60,
    "seconds": 2175832346,
    "code": "19208282"
  },
  {
    "seedHex": "c30a922f61283eaadc6ba37ac69b7ffa36e5d2c8f8031b229ab1cb5a7ab5a1fab8b9abb0b1910e2bd2a7b70055",
    "seedB32": "YMFJEL3BFA7KVXDLUN5MNG377I3OLUWI7ABRWIU2WHFVU6VVUH5LRONLWCYZCDRL2KT3OACV",
    "algorithm": "SHA512",
    "digits": 6,
    "period": 15,
    "seconds": 2636295945,
    "code": "185562"
  },
  {
    "seedHex": "c36c62bcc81b98398e530738f615ed6974b15be1203481dfa569765f84221adf",
    "seedB32": "YNWGFPGIDOMDTDSTA44PMFPNNF2LCW7BEA2IDX5FNF3F7BBCDLPQ",
    "algorithm": "SHA512",
    "digits": 8,
    "period": 15,
    "seconds": 297289857,
    "code": "49715530"
  },
  {
    "seedHex": "f430ca9a04f96a8a09eccbea1454c240d9803b012f262f58acc0",
    "seedB32": "6QYMVGQE7FVIUCPMZPVBIVGCIDMYAOYBF4TC6WFMYA",
    "algorithm": "SHA1",
    "digits": 8,
    "period": 30,
    "seconds": 1562525999,
    "code": "42020745"
  },
  {
    "seedHex": "04bde39f4e17fd4f113a87efe458509ba08d1f9118ba76758831829c8ef503d1224c3d3141e1",
    "seedB32": "AS66HH2OC76U6EJ2Q7X6IWCQTOQI2H4RDC5HM5MIGGBJZDXVAPISETB5GFA6C",
    "algorithm": "SHA1",
    "digits": 6,
    "period": 60,
    "seconds": 301220216,
    "code": "736025"
  },
  {
    "seedHex": "00fbfc5e9ee05897bbf598e002285b7bd73e847e26d502984bc6b888d1bc1cf39c2ce907d74d197ef17231f7d675b4",
    "seedB32": "AD57YXU64BMJPO7VTDQAEKC3PPLT5BD6E3KQFGCLY24IRUN4DTZZYLHJA7LU2GL66FZDD56WOW2A",
    "algorithm": "SHA1",
    "digits": 8,
    "period": 30,
    "seconds": 488113229,
    "code": "54045230"
  },
  {
    "seedHex": "b274f5e1c1f2cc7a96528fe2eab5",
    "seedB32": "WJ2PLYOB6LGHVFSSR7ROVNI",
    "algorithm": "SHA1",
    "digits": 6,
    "period": 60,
    "seconds": 215658101,
    "code": "030233"
  },
  {
    "seedHex": "d15d4dc04709264a18f830",
    "seedB32": "2FOU3QCHBETEUGHYGA",
    "algorithm": "SHA256",
    "digits": 6,
    "period": 15,
    "seconds": 1175760267,
    "code": "098922"
  },
  {
    "seedHex": "3f6af4482ef5ce447eb9d6055915e85bae4bfa9d",
    "seedB32": "H5VPISBO6XHEI7VZ2YCVSFPILOXEX6U5",
    "algorithm": "SHA256",
    "digits": 8,
    "period": 15,
    "seconds": 2756004786,
    "code": "45454815"
  },
  {
    "seedHex": "ca9d7ce3b9a632836cc160d26c430a01",
    "seedB32": "ZKOXZY5ZUYZIG3GBMDJGYQYKAE",
    "algorithm": "SHA256",
    "digits": 8,
    "period": 30,
    "seconds": 1959012132,
    "code": "18780154"
  },
  {
    "seedHex": "d8735a612640068ed48847b6f12207728b8c87e029aedc5d",
    "seedB32": "3BZVUYJGIADI5VEII63PCIQHOKFYZB7AFGXNYXI",
    "algorithm": "SHA1",
    "digits": 8,
    "period": 60,
    "seconds": 146312351,
    "code": "25878846"
  },
  {
    "seedHex": "ecf0c08af53e3273529ae3a4a42c31c1f7ea723f3926a995a53968a8c646",
    "seedB32": "5TYMBCXVHYZHGUU24OSKILBRYH36U4R7HETKTFNFHFUKRRSG",
    "algorithm": "SHA1",
    "digits": 8,
    "period": 30,
    "seconds": 2861928849,
    "code": "07765799"
  },
  {
    "seedHex": "40b08d6f965b7de00159b5b5",
    "seedB32": "ICYI234WLN66AAKZWW2Q",
    "algorithm": "SHA256",
    "digits": 7,
    "period": 30,
    "seconds": 1452698543,
    "code": "6713974"
  },
  {
    "seedHex": "b15207c23a66d08a6c6eac4cf6b9",
    "seedB32": "WFJAPQR2M3IIU3DOVRGPNOI",
    "algorithm": "SHA512",
    "digits": 6,
    "period": 30,
    "seconds": 197928167,
    "code": "973041"
  }
];
export const HOTP_CASES: HotpCase[] = [
  {
    "seedHex": "2fd020c7b74b23086bc18fb16b8d8a38",
    "algorithm": "SHA1",
    "digits": 6,
    "counter": "0",
    "code": "495020"
  },
  {
    "seedHex": "e2ce71ae910020b51996d11dacb376a2f535ff54150899139e6bd57cadf5990c",
    "algorithm": "SHA256",
    "digits": 7,
    "counter": "1",
    "code": "7138754"
  },
  {
    "seedHex": "16f4891ca6cbcb339f283676e814b95ea1ea850962c344484305bea9bd4a9809d828c21e1570",
    "algorithm": "SHA512",
    "digits": 8,
    "counter": "2147483647",
    "code": "17388454"
  },
  {
    "seedHex": "f2cfd6c743b420f5e51f0466f8c4b498fcc1ba7a",
    "algorithm": "SHA256",
    "digits": 6,
    "counter": "4294967295",
    "code": "865592"
  },
  {
    "seedHex": "ad05975dcca9253350c0beff5b71843ef807b34b985ce4a4f1acab59dac6b0b8f8743e",
    "algorithm": "SHA256",
    "digits": 8,
    "counter": "4294967296",
    "code": "32896843"
  },
  {
    "seedHex": "6f422cd7a1b0f4f35a99b43da4b4f774a62e4f9821c7c6c481130926",
    "algorithm": "SHA1",
    "digits": 8,
    "counter": "9007199254740991",
    "code": "06097110"
  },
  {
    "seedHex": "15bdf339088e33407adff8b55428e2f942ed8da13ed7cb",
    "algorithm": "SHA512",
    "digits": 7,
    "counter": "9007199254740992",
    "code": "6072891"
  },
  {
    "seedHex": "a8c4174a39a8f859dd2c6a55062f676b633003f01b53a00a",
    "algorithm": "SHA512",
    "digits": 8,
    "counter": "9223372036854775808",
    "code": "93630772"
  },
  {
    "seedHex": "852decf86112b76ef6540b291c0b1faeb1289aa3c3cf7f01077b3b39eca0a1ccdf2fab8dd70b7511",
    "algorithm": "SHA256",
    "digits": 6,
    "counter": "18446744073709551615",
    "code": "410671"
  },
  {
    "seedHex": "876f3e44c00a3a4a567fc820927d5a300fa3495269e4d5f05f0cb0",
    "algorithm": "SHA512",
    "digits": 6,
    "counter": "279033534326038",
    "code": "519150"
  },
  {
    "seedHex": "927a455dfc07f0924a67e9d61436fa6f81638453f7de9d8b7c7a0cb1db",
    "algorithm": "SHA512",
    "digits": 7,
    "counter": "249187755333192",
    "code": "4494136"
  },
  {
    "seedHex": "7c9c484efd7b31e87ed28e7c436d3cc81ce0dbdda1a06bb2f5dcc5",
    "algorithm": "SHA256",
    "digits": 6,
    "counter": "197748776452698",
    "code": "725890"
  },
  {
    "seedHex": "25debbf4db43ed66cd10ddbf7a6d8b69",
    "algorithm": "SHA512",
    "digits": 6,
    "counter": "95856680843318",
    "code": "978778"
  },
  {
    "seedHex": "6db22d4d762fb7a7bbf76f84348bafcd44187b255a6f600a",
    "algorithm": "SHA512",
    "digits": 7,
    "counter": "113390723859659",
    "code": "2001186"
  },
  {
    "seedHex": "4b282079104e9b76aa0ec2b014e455be86c7990e649b6d5aa0d5db5b29803722ae81daf00fd8",
    "algorithm": "SHA1",
    "digits": 6,
    "counter": "100142530261072",
    "code": "631745"
  },
  {
    "seedHex": "0a85a6869112bc6365df8a0419dfe8bc",
    "algorithm": "SHA1",
    "digits": 7,
    "counter": "257063101580073",
    "code": "8543774"
  },
  {
    "seedHex": "456046c509b9a3941a24869fc6910793a74a0944ede020ec9abe2708d40948",
    "algorithm": "SHA512",
    "digits": 8,
    "counter": "215444682492510",
    "code": "46387899"
  },
  {
    "seedHex": "45a3866d05c294790eeff2ce4137151fec6c5dc2bb72a1d9785606918953927896a3",
    "algorithm": "SHA512",
    "digits": 8,
    "counter": "191691372754960",
    "code": "14644343"
  },
  {
    "seedHex": "7733f4ef32884b33f2c91d3613d51a19c6a27e1852b4f3e7c803aaeb8ed516016cee795c",
    "algorithm": "SHA1",
    "digits": 7,
    "counter": "61833133234444",
    "code": "8067686"
  },
  {
    "seedHex": "50ffe7de8a72ccc737d44a9269f9f749ecf14717e4",
    "algorithm": "SHA256",
    "digits": 8,
    "counter": "204399922540234",
    "code": "97743839"
  }
];
/** The Base32 text of the seed goes where {SEED} is. */
export const LINK_CASES: LinkCase[] = [
  {
    "title": "plain",
    "seedHex": "eac6a8a67c5b132182096013834c2f96e6b1daa5",
    "options": {
      "type": "totp",
      "issuer": "",
      "account": "alice@example.com",
      "algorithm": "SHA1",
      "digits": 6,
      "period": 30,
      "counter": "0"
    },
    "uri": "otpauth://totp/alice%40example.com?secret={SEED}"
  },
  {
    "title": "issuer with a space, a colon and reserved characters",
    "seedHex": "c8117fbc424c2e6161a27e71c8610bcfdda5d296",
    "options": {
      "type": "totp",
      "issuer": "ACME Co: R&D (EU) !*'",
      "account": "Jo O'Brien+test@example.com",
      "algorithm": "SHA1",
      "digits": 7,
      "period": 45,
      "counter": "0"
    },
    "uri": "otpauth://totp/ACME%20Co%3A%20R%26D%20%28EU%29%20%21%2A%27:Jo%20O%27Brien%2Btest%40example.com?secret={SEED}&issuer=ACME%20Co%3A%20R%26D%20%28EU%29%20%21%2A%27&digits=7&period=45"
  },
  {
    "title": "HOTP with a counter",
    "seedHex": "4ef34f9fb2fe7522d61006930c66093dc6cbdfb2",
    "options": {
      "type": "hotp",
      "issuer": "Example",
      "account": "bob",
      "algorithm": "SHA1",
      "digits": 6,
      "period": 30,
      "counter": "7"
    },
    "uri": "otpauth://hotp/Example:bob?secret={SEED}&issuer=Example&counter=7"
  },
  {
    "title": "non-ASCII with SHA512",
    "seedHex": "66766508f17f7bcc6526df551b84761388913bab010176dfef476c8001e77d5eb2d3eccf6544455230295c59f4694cc0c44133d1aede1ce6d7672a365c347c82",
    "options": {
      "type": "totp",
      "issuer": "Caf\u00e9 \u00dcn\u00efcode",
      "account": "zo\u00eb@example.com",
      "algorithm": "SHA512",
      "digits": 8,
      "period": 60,
      "counter": "0"
    },
    "uri": "otpauth://totp/Caf%C3%A9%20%C3%9Cn%C3%AFcode:zo%C3%AB%40example.com?secret={SEED}&issuer=Caf%C3%A9%20%C3%9Cn%C3%AFcode&algorithm=SHA512&digits=8&period=60"
  }
];
