
typedef unsigned int u32;
typedef unsigned short u16;
typedef unsigned long long u64;
struct Big { u32 words; unsigned char bytes[256]; };
struct Key { u32 type; u32 reserved; const void *exponent; const struct Big *modulus; };
extern int cal_check(const void *,u32,const void *,u32,const void *);
extern const struct Key oem_key __attribute__((visibility("hidden")));
static const struct Big local_key={64,{147,23,62,50,50,170,106,127,226,103,7,248,17,32,111,166,20,248,118,136,28,186,196,9,161,164,111,255,243,219,203,36,184,11,27,176,96,37,188,229,45,100,121,18,84,21,20,198,85,1,84,97,72,239,210,59,236,141,233,234,92,191,130,48,160,45,99,182,8,4,191,213,96,231,231,132,211,171,126,160,138,110,73,17,145,184,21,202,28,110,88,118,12,238,116,117,83,52,187,107,108,10,151,218,37,134,240,115,50,25,86,224,38,150,117,28,248,157,172,135,99,179,61,117,91,190,196,89,48,251,62,50,14,78,76,171,200,6,238,11,97,53,146,248,109,219,78,187,82,202,234,191,104,192,91,228,34,230,250,186,136,88,216,208,236,254,37,47,37,33,116,121,99,60,26,209,189,136,151,17,14,36,93,131,20,159,8,82,36,152,162,187,178,83,118,91,179,173,101,69,211,83,197,109,153,168,216,108,156,130,139,64,233,47,192,213,226,182,84,122,199,209,239,79,194,35,171,13,218,71,93,90,123,194,148,207,78,174,138,21,128,229,115,53,245,48,160,12,57,23,91,169,212,187,142,174}};
__attribute__((section(".text.entry"),visibility("hidden")))
int dual_check(const unsigned char *fsc,u32 length,const unsigned char *parsed,const struct Key *oem) {
    u32 offset=*(const u16 *)(parsed+26);
    u32 signature_length=(u16)(length-offset);
    int result=cal_check(fsc+offset,signature_length,fsc,offset,oem);
    if (result!=0xf9 || oem!=&oem_key || oem->type!=8) return result;
    struct Key local={8,0,oem->exponent,&local_key};
    return cal_check(fsc+offset,signature_length,fsc,offset,&local);
}
