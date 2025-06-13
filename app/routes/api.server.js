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

// GraphQL mutation for updating variant price
const UPDATE_VARIANT_PRICE_MUTATION = `
mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
  productVariantsBulkUpdate(productId: $productId, variants: $variants) {
    product {
      id
    }
    productVariants {
      id
      price
    }
    userErrors {
      field
      message
    }
  }
}
`;

export async function loader({ request }) {
  try {
    const url = new URL(request.url);
    const shop = url.searchParams.get("shop");
    const productId = url.searchParams.get("productId");

    console.log('shop info and product id ', shop, productId);

    if (!shop || !productId) {
      return Response.json(
        { error: "Missing required query parameters: 'shop' and 'productId'" },
        { status: 400 }
      );
    }

    const review = await prisma.review.findUnique({
      where: {
        shop_productId: {
          shop,
          productId,
        },
      },
      select: {
        snippet: true,
        createdAt: true,
      },
    });

    return Response.json({ review });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}


export async function action({ request }) {
  try {
    const body = await request.json();
    const { shop, variantId, price, productId, reviewSnippet } = body;

    // --- REVIEW LOGIC ---
    if (shop && productId && typeof reviewSnippet === "string") {
      // Check for existing review for this shop and product
      const existingReview = await prisma.review.findUnique({
        where: {
          shop_productId: {
            shop,
            productId,
          },
        },
      });

      let reviewResult;
      if (existingReview) {
        // Update the review
        reviewResult = await prisma.review.update({
          where: {
            shop_productId: {
              shop,
              productId,
            },
          },
          data: {
            snippet: reviewSnippet,
          },
        });
      } else {
        // Create a new review
        reviewResult = await prisma.review.create({
          data: {
            shop,
            productId,
            snippet: reviewSnippet,
          },
        });
      }

      return Response.json({
        success: true,
        review: reviewResult,
      });
    }

    // --- VARIANT PRICE UPDATE LOGIC ---
    if (!shop || !variantId || typeof price === "undefined" || !productId) {
      return Response.json(
        {
          error:
            "Missing required fields: 'shop', 'variantId', 'productId', or 'price'",
        },
        { status: 400 },
      );
    }

    const access_token = await getAccessToken(shop);
    if (!access_token) {
      return Response.json(
        { error: "No access token found for shop" },
        { status: 403 },
      );
    }

    //Admin API endpoint
    const SHOPIFY_STORE_URL = `https://${shop}/admin/api/2025-04/graphql.json`;

    // Send mutation request
    const response = await axios.post(
      SHOPIFY_STORE_URL,
      {
        query: UPDATE_VARIANT_PRICE_MUTATION,
        variables: {
          productId,
          variants: [{ id: variantId, price }],
        },
      },
      {
        headers: {
          "Content-Type": "application/json",
          "X-Shopify-Access-Token": access_token,
        },
      },
    );

    const data = response.data;

    // Handle errors
    if (
      data.errors ||
      (data.data.productVariantsBulkUpdate &&
        data.data.productVariantsBulkUpdate.userErrors.length > 0)
    ) {
      return Response.json(
        {
          error: data.errors || data.data.productVariantsBulkUpdate.userErrors,
        },
        { status: 400 },
      );
    }

    // Success
    return Response.json({
      success: true,
      product: data.data.productVariantsBulkUpdate.product,
      variants: data.data.productVariantsBulkUpdate.productVariants,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
