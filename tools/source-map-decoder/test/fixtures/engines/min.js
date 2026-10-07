(()=>{function e(r){if(r<=0)throw new RangeError("value must be positive: "+r);return r}var n=class{total=0;add(t){this.total+=e(t)}};function u(r){let t=new n;for(let o of r)t.add(o);return t.total}function i(){return u([3,5,-2,7])}i();})();
//# sourceMappingURL=min.js.map
