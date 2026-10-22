
const BASE_URL = "http://localhost:3002";

async function seedDemoSite() {
  console.log("FixLoop demo seed configuration");
  console.log(`Demo site URL: ${BASE_URL}`);

  const scenarios = [
    {
      id: "TC1",
      name: "Broken internal link",
      source: "/about",
      target: "/missing-page",
      expectedStatus: 404,
    },
    {
      id: "TC2",
      name: "Redirect chain",
      chain: ["/old", "/a", "/b", "/final"],
      expectedHops: 3,
    },
    {
      id: "TC3",
      name: "Large website",
      expectedMinimumPages: 250,
      recommendedCrawlLimit: 200,
    },
    {
      id: "TC4",
      name: "Broken link fix",
      target: "/missing-page",
      expectedAfterFix: "fixed",
    },
  ];

  console.log("Configured demo scenarios:");
  console.table(
    scenarios.map((scenario) => ({
      id: scenario.id,
      name: scenario.name,
    }))
  );

  console.log(
    "Note: These are test scenario definitions, not actual seeded server data."
  );
}

seedDemoSite().catch((error) => {
  console.error("Demo seeding failed:", error);
  process.exitCode = 1;
});
