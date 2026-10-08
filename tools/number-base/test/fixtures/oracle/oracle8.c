/* Exhaustive 8-bit oracle: for each signedness and operator, one byte per (a,b) pair, a-major. 
   Each result is the C expression computed on 8-bit operands (promoted to int by C) and cast back to the 8-bit type. */
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#define OPS 13
static const char *names[OPS] = {"add","sub","mul","div","rem","and","or","xor","shl","shr","ushr","not","neg"};

#define GEN(T, UT, TAG) \
static void gen_##TAG(FILE *f) { \
  for (int op = 0; op < OPS; op++) { \
    unsigned char buf[65536]; unsigned char valid[65536]; \
    for (int ia = 0; ia < 256; ia++) for (int ib = 0; ib < 256; ib++) { \
      T a = (T)ia, b = (T)ib; int r = 0, ok = 1; int k = ia*256+ib; \
      switch (op) { \
        case 0: r = (T)(a + b); break; \
        case 1: r = (T)(a - b); break; \
        case 2: r = (T)(a * b); break; \
        case 3: if (b == 0) ok = 0; else r = (T)(a / b); break; \
        case 4: if (b == 0) ok = 0; else r = (T)(a % b); break; \
        case 5: r = (T)(a & b); break; \
        case 6: r = (T)(a | b); break; \
        case 7: r = (T)(a ^ b); break; \
        case 8: if (b < 0 || b > 31) ok = 0; else r = (T)(a << b); break; \
        case 9: if (b < 0 || b > 31) ok = 0; else r = (T)(a >> b); break; \
        case 10: if (b < 0 || b > 31) ok = 0; else r = (T)(UT)((UT)a >> b); break; \
        case 11: r = (T)(~a); break; \
        case 12: r = (T)(-a); break; \
      } \
      buf[k] = ok ? (unsigned char)(UT)r : 0; valid[k] = (unsigned char)ok; \
    } \
    fprintf(f, "%s %s ", #TAG, names[op]); \
    for (int i = 0; i < 65536; i++) fprintf(f, "%02x%s", buf[i], valid[i] ? "" : "!"); \
    fprintf(f, "\n"); \
  } \
}
GEN(int8_t, uint8_t, int8)
GEN(uint8_t, uint8_t, uint8)
int main(void){ gen_int8(stdout); gen_uint8(stdout); return 0; }
