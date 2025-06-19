import axios from "axios";
import prisma from "../db.server";

// Helper to fetch access token for a shop
const getAccessToken = async (shop) => {
  if (!shop) throw new Error("Shop name is required to fetch settings.");
  const session = await prisma.session.findFirst({
    where: { shop: shop },
    select: { accessToken: true },
  });

  if (!session) return null;
  return session.accessToken;
};

const PRODUCTS_PER_PAGE = 10;

const PRODUCTS_QUERY = `
  query Products($first: Int, $last: Int, $after: String, $before: String) {
    products(first: $first, last: $last, after: $after, before: $before) {
      pageInfo {
        hasNextPage
        hasPreviousPage
        endCursor
        startCursor
      }
      edges {
        cursor
        node {
          id
          title
          featuredMedia {
            preview {
              image {
                url
              }
            }
          }
          variants(first: 5) {
            nodes {
              id
              compareAtPrice
              price
              image {
                url
              }
            }
          }
        }
      }
    }
  }
`;

export async function loader({ request }) {
  try {
    const url = new URL(request.url);
    const after = url.searchParams.get("after");
    const before = url.searchParams.get("before");
    const shop = url.searchParams.get("shop");

    if (!shop) {
      return new Response(
        JSON.stringify({ error: "Missing shop parameter" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    const accessToken = await getAccessToken(shop);
    if (!accessToken) {
      return new Response(
        JSON.stringify({ error: "Access token not found for shop" }),
        { status: 401, headers: { "Content-Type": "application/json" } }
      );
    }

    // Build GraphQL variables
    let variables = {};
    if (after) {
      variables = { first: PRODUCTS_PER_PAGE, after };
    } else if (before) {
      variables = { last: PRODUCTS_PER_PAGE, before };
    } else {
      variables = { first: PRODUCTS_PER_PAGE };
    }

    // Call Shopify GraphQL API
    const shopDomain = shop.includes(".") ? shop : `${shop}.myshopify.com`;
    const graphqlUrl = `https://${shopDomain}/admin/api/2024-04/graphql.json`;

    const gqlRes = await axios.post(
      graphqlUrl,
      { query: PRODUCTS_QUERY, variables },
      {
        headers: {
          "X-Shopify-Access-Token": accessToken,
          "Content-Type": "application/json",
        },
      }
    );

    const result = gqlRes.data;
    if (!result.data || !result.data.products) {
      return new Response(
        JSON.stringify({ error: "Failed to fetch products from Shopify" }),
        { status: 500, headers: { "Content-Type": "application/json" } }
      );
    }

    // Fetch reviews for this shop
    const reviews = await prisma.review.findMany({
      where: { shop },
      select: { productId: true, snippet: true },
    });

    // Map productId to snippet for quick lookup
    const reviewMap = {};
    reviews.forEach((r) => {
      reviewMap[r.productId] = r.snippet;
    });

    // Attach review to each product node
    const productsWithReviews = result.data.products.edges.map((edge) => ({
      ...edge.node,
      review: reviewMap[edge.node.id] || "",
      cursor: edge.cursor,
    }));

    return new Response(
      JSON.stringify({
        products: productsWithReviews,
        pageInfo: result.data.products.pageInfo,
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}
