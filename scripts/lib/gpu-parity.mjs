export async function checkGpuParity(
  oracle,
  { routesConflict, directionalLayers },
) {
  const route = (id, points, layer = 0, width = 300, vias = []) => ({
    id,
    points,
    layer,
    width,
    vias,
    terminals: [id + ".a", id + ".b"],
    control: points[0],
    pressure: 0,
  });
  const p = (x, y) => ({ x, y });
  const cases = [
    route("horizontal", [p(0, 10000), p(100000, 10000)]),
    route("middle-crossing", [p(50123, 0), p(50123, 80000)]),
    route("other-layer", [p(50123, 0), p(50123, 80000)], 1),
    route("collinear-disjoint", [p(110000, 10000), p(120000, 10000)]),
    route("collinear-overlap", [p(12345, 10000), p(60000, 10000)]),
    route("zero-segment", [p(40000, 10000), p(40000, 10000)]),
    route("diagonal", [p(0, 0), p(90000, 90000)]),
    route("reverse-diagonal", [p(90000, 0), p(0, 90000)], 0, 901),
  ];
  for (const delta of [-0.001, -0.0000001, 0, 0.0000001, 0.001])
    cases.push(
      route("boundary-" + delta, [
        p(0, 10650 + delta),
        p(100000, 10650 + delta),
      ]),
    );
  cases.push(
    route(
      "via-on-other-layer",
      [p(10000, 30000), p(50000, 10000), p(90000, 30000)],
      2,
      301,
      [
        {
          x: 50000,
          y: 10000,
          fromLayer: 2,
          toLayer: 3,
          radius: 450,
          drill: 300,
        },
      ],
    ),
  );
  let rng = 42017;
  const random = () =>
    (rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296;
  for (let i = 0; i < 96; i++) {
    const x = Math.floor(random() * 200000),
      y = Math.floor(random() * 160000);
    const points = [
      p(x, y),
      p(x + Math.floor(random() * 40000), y),
      p(x + Math.floor(random() * 40000), y + Math.floor(random() * 40000)),
    ];
    cases.push(
      directionalLayers(
        route("random-" + i, points, i % 4, 100 + i * 7),
        i % 4,
        (i + 1) % 4,
      ),
    );
  }
  const results = [];
  for (const clearance of [100, 350, 2000]) {
    const matrix = await oracle.conflicts(cases, cases, clearance);
    let mismatches = 0;
    for (let i = 0; i < cases.length; i++)
      for (let j = 0; j < cases.length; j++) {
        const expected =
          cases[i].id !== cases[j].id &&
          routesConflict(cases[i], cases[j], clearance)
            ? 1
            : 0;
        if (matrix[i * cases.length + j] !== expected) mismatches++;
      }
    results.push({ clearance, pairs: matrix.length, mismatches });
  }
  return {
    passed: results.every((r) => !r.mismatches),
    device: oracle.info,
    results,
    stats: oracle.stats,
  };
}
