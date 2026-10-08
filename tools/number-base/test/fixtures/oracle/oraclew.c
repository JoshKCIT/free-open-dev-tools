/* Sampled oracle at 16, 32, 64 and 128 bits. Reads lines "width signed op a b" (a and b as hex bit patterns) from stdin,
   prints "width signed op a b result" (result as a hex bit pattern) or "... SKIP" where C leaves the operation undefined
   (a shift count outside the range the type's own promotion defines, division by zero, or INT_MIN / -1, which traps on x86). */
#include <stdio.h>
#include <stdint.h>
#include <string.h>
#include <stdlib.h>
typedef unsigned __int128 u128;
typedef __int128 i128;
static u128 parse(const char *s) { u128 v = 0; for (; *s; s++) { int d = (*s >= 'a') ? *s - 'a' + 10 : *s - '0'; v = (v << 4) | (u128)d; } return v; }
static void print(u128 v, int width) { char buf[40]; int n = 0; int digits = width / 4; for (int i = 0; i < digits; i++) { buf[n++] = "0123456789abcdef"[(int)((v >> (4 * (digits - 1 - i))) & 0xf)]; } buf[n] = 0; fputs(buf, stdout); }
#define BODY(T, UT, W, PROMOTES) do { \
  T a = (T)A, b = (T)B; T r = 0; int ok = 1; \
  int maxshift = (PROMOTES) ? 31 : (W - 1); \
  int neg_or_big = (b < 0) || ((i128)(UT)b > (i128)maxshift); \
  (void)neg_or_big; \
  if (!strcmp(op, "+")) r = (T)(a + b); \
  else if (!strcmp(op, "-")) r = (T)(a - b); \
  else if (!strcmp(op, "*")) r = (T)(a * b); \
  else if (!strcmp(op, "/")) { if (b == 0 || ((T)-1 < 0 && b == (T)-1 && a == (T)((UT)1 << (W - 1)) && (W) >= 32)) ok = 0; else r = (T)(a / b); } \
  else if (!strcmp(op, "%")) { if (b == 0 || ((T)-1 < 0 && b == (T)-1 && a == (T)((UT)1 << (W - 1)) && (W) >= 32)) ok = 0; else r = (T)(a % b); } \
  else if (!strcmp(op, "&")) r = (T)(a & b); \
  else if (!strcmp(op, "|")) r = (T)(a | b); \
  else if (!strcmp(op, "^")) r = (T)(a ^ b); \
  else if (!strcmp(op, "<<")) { if (((T)-1 < 0 && b < 0) || (UT)b > (UT)maxshift) ok = 0; else r = (T)(a << (int)(UT)b); } \
  else if (!strcmp(op, ">>")) { if (((T)-1 < 0 && b < 0) || (UT)b > (UT)maxshift) ok = 0; else r = (T)(a >> (int)(UT)b); } \
  else if (!strcmp(op, ">>>")) { if (((T)-1 < 0 && b < 0) || (UT)b > (UT)maxshift) ok = 0; else r = (T)(UT)((UT)a >> (int)(UT)b); } \
  else ok = 0; \
  if (!ok) { printf("SKIP\n"); } else { print((u128)(UT)r, W); printf("\n"); } \
} while (0)
int main(void) {
  char line[512];
  while (fgets(line, sizeof line, stdin)) {
    int width, sgn; char op[8], as[80], bs[80];
    if (sscanf(line, "%d %d %7s %79s %79s", &width, &sgn, op, as, bs) != 5) continue;
    u128 A = parse(as), B = parse(bs);
    printf("%d %d %s %s %s ", width, sgn, op, as, bs);
    if (width == 16 && sgn) BODY(int16_t, uint16_t, 16, 1);
    else if (width == 16) BODY(uint16_t, uint16_t, 16, 1);
    else if (width == 32 && sgn) BODY(int32_t, uint32_t, 32, 0);
    else if (width == 32) BODY(uint32_t, uint32_t, 32, 0);
    else if (width == 64 && sgn) BODY(int64_t, uint64_t, 64, 0);
    else if (width == 64) BODY(uint64_t, uint64_t, 64, 0);
    else if (width == 128 && sgn) BODY(i128, u128, 128, 0);
    else if (width == 128) BODY(u128, u128, 128, 0);
    else printf("SKIP\n");
  }
  return 0;
}
