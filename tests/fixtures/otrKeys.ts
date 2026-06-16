// Pre-generated OTR DSA key pairs so tests skip the ~2s DSA keygen. Produced once
// via `new DSA().packPrivate()`; OTRv3 is a frozen protocol, so these stay valid.
// Both keys share the standard DSA domain parameters (p, q, g) and differ only in
// the private/public pair, exactly as the library generates them.

export interface OtrKeyFixture {
  packed: string;
  fingerprint: string;
}

export const ALICE_KEY: OtrKeyFixture = {
  packed:
    "AAAAAACAm+B6qWJSmIu3x5KSJL5YWlu2zVHwonmczu/OQ3A9QOkPYgQPbcvs4MhQzZlgj25S0MxXr2qCBoL1YK5e7coBNZ1s9LLbkWRhc+rJvJDtCBacg0eQtyUbduR+4pAfdkBC2MoGjRoFQKPuvpwioukZ36IYf5jnpdSF6LUBJZvQQd0AAAAUvMzGo4jlty7WuC7NYQeq31qEfe8AAACAMstA2gAJc7w56nzH1Dzr0NGVVjfJFZeiwuQEQFyYUWbwJ42JqlYJAgnM5GkfDbp5CJDusKStGmc2Slbno4zP9GnEAw6glk8U2TpZzvYoV2k56SJnQkcpb3DFt9AWd7tOyuK6aFJ288flJxkHYIp0YHIxA3lJ6z8O40Oy12hMWskAAACAbgXWj5gZ3KmrUf5dlzCaDktlQE7Bqu2EFMn5FirgMsix0ItG1BsDdkbGY7pfXriXEmJ/v+QwVZZisXjJ5GNAmPqYsBHMuM/XdZL/XKwmGBF8xA1gGEcTg6bBxHjBfz7eVhO0PERTY/QVn7tOVaIzrY/R80xtbyW/8lT6ZKKOyaUAAAAULlvkKaipKnAGVu/osrrH3VftLpg=",
  fingerprint: "09d1d2fa51e7ca597a995059b1259e68c5167266",
};

export const BOB_KEY: OtrKeyFixture = {
  packed:
    "AAAAAACAm+B6qWJSmIu3x5KSJL5YWlu2zVHwonmczu/OQ3A9QOkPYgQPbcvs4MhQzZlgj25S0MxXr2qCBoL1YK5e7coBNZ1s9LLbkWRhc+rJvJDtCBacg0eQtyUbduR+4pAfdkBC2MoGjRoFQKPuvpwioukZ36IYf5jnpdSF6LUBJZvQQd0AAAAUvMzGo4jlty7WuC7NYQeq31qEfe8AAACAMstA2gAJc7w56nzH1Dzr0NGVVjfJFZeiwuQEQFyYUWbwJ42JqlYJAgnM5GkfDbp5CJDusKStGmc2Slbno4zP9GnEAw6glk8U2TpZzvYoV2k56SJnQkcpb3DFt9AWd7tOyuK6aFJ288flJxkHYIp0YHIxA3lJ6z8O40Oy12hMWskAAACACD+xx+WLSAsFmcQAiEQsU2HJ0tsoKkq5M8KxZu00N9o+W57y640TWdF6CH0klWmne0lD+oxUQdif8UrGEnWW++IwgcdXqYzufZXWKaTuFt6J1et/nP2S6a0wCyZTn+E4JkYHds2Je4czggfmciJO2szSHouN9DxhatGebv79rhUAAAAURQUBq9kQ4rWmC1ne7yIM+VUFil8=",
  fingerprint: "c5ffaf4bb0fabcd5441e9094af35f309a09f4cbd",
};
