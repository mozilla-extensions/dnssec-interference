# Shield Study Schemas for Shield v3

```
npm install
```

## generate some packets

```
node validateSchemas.js make -t study -n 10
node validateSchemas.js make -t addon -n 10
node validateSchemas.js make -t error -n 10
```

Or pre-baked at:

[Example Valid Packets](./example.valid.packets.json)

`node validateSchemas.js example`



## Schemas

`node split-schemas.js`

- [Schema](./shield-schemas.json)
- [Split Schemas](./schemas/)




