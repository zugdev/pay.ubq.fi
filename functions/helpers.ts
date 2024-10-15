import { BigNumberish } from "ethers";
import { isAllowed } from "../shared/allowed-country-list";
import { isGiftCardAvailable } from "../shared/helpers";
import { GiftCard } from "../shared/types";
import { getGiftCardById } from "./post-order";
import { fallbackIntlMastercard, fallbackIntlVisa, masterCardIntlSkus, visaIntlSkus } from "./reloadly-lists";
import { AccessToken, ReloadlyFailureResponse } from "./types";

export const commonHeaders = {
  "Content-Type": "application/json",
  Accept: "application/com.reloadly.giftcards-v1+json",
};

export interface Env {
  USE_RELOADLY_SANDBOX: string;
  RELOADLY_API_CLIENT_ID: string;
  RELOADLY_API_CLIENT_SECRET: string;
}

export interface ReloadlyAuthResponse {
  access_token: string;
  scope: string;
  expires_in: number;
  token_type: string;
}

export async function getAccessToken(env: Env): Promise<AccessToken> {
  console.log("Using Reloadly Sandbox:", env.USE_RELOADLY_SANDBOX !== "false");

  const url = "https://auth.reloadly.com/oauth/token";
  const options = {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({
      client_id: env.RELOADLY_API_CLIENT_ID,
      client_secret: env.RELOADLY_API_CLIENT_SECRET,
      grant_type: "client_credentials",
      audience: env.USE_RELOADLY_SANDBOX === "false" ? "https://giftcards.reloadly.com" : "https://giftcards-sandbox.reloadly.com",
    }),
  };

  const res = await fetch(url, options);
  if (res.status == 200) {
    const successResponse = (await res.json()) as ReloadlyAuthResponse;
    return {
      token: successResponse.access_token,
      isSandbox: env.USE_RELOADLY_SANDBOX !== "false",
    };
  }
  throw `Getting access token failed: ${JSON.stringify(await res.json())}`;
}

export function getBaseUrl(isSandbox: boolean): string {
  if (isSandbox === false) {
    return "https://giftcards.reloadly.com";
  }
  return "https://giftcards-sandbox.reloadly.com";
}

export async function findBestCard(countryCode: string, amount: BigNumberish, accessToken: AccessToken): Promise<GiftCard> {
  if (!isAllowed(countryCode)) {
    throw new Error(`Country ${countryCode} is not in the allowed country list.`);
  }

  const masterCards = await getGiftCards("mastercard", countryCode, accessToken);

  const masterCardIntlSku = masterCardIntlSkus.find((sku) => sku.countryCode == countryCode);
  if (masterCardIntlSku) {
    const tokenizedIntlMastercard = masterCards.find((masterCard) => masterCard.productId == masterCardIntlSku.sku);
    if (tokenizedIntlMastercard && isGiftCardAvailable(tokenizedIntlMastercard, amount)) {
      return tokenizedIntlMastercard;
    }
  }

  const fallbackMastercard = await getFallbackIntlMastercard(accessToken);
  if (fallbackMastercard && isGiftCardAvailable(fallbackMastercard, amount)) {
    return fallbackMastercard;
  }

  const visaCards = await getGiftCards("visa", countryCode, accessToken);
  const visaIntlSku = visaIntlSkus.find((sku) => sku.countryCode == countryCode);
  if (visaIntlSku) {
    const intlVisa = visaCards.find((visaCard) => visaCard.productId == visaIntlSku.sku);
    if (intlVisa && isGiftCardAvailable(intlVisa, amount)) {
      return intlVisa;
    }
  }

  const fallbackVisa = await getFallbackIntlVisa(accessToken);
  if (fallbackVisa && isGiftCardAvailable(fallbackVisa, amount)) {
    return fallbackVisa;
  }

  const anyMastercard = masterCards.find((masterCard) => isGiftCardAvailable(masterCard, amount));
  if (anyMastercard) {
    return anyMastercard;
  }

  const anyVisa = visaCards.find((visaCard) => isGiftCardAvailable(visaCard, amount));
  if (anyVisa) {
    return anyVisa;
  }

  throw new Error(`No suitable card found for country code ${countryCode} and amount ${amount}.`);
}

async function getFallbackIntlMastercard(accessToken: AccessToken): Promise<GiftCard | null> {
  try {
    return await getGiftCardById(fallbackIntlMastercard.sku, accessToken);
  } catch (e) {
    console.error(`Failed to load international US mastercard: ${JSON.stringify(fallbackIntlMastercard)}`, e);
    return null;
  }
}

async function getFallbackIntlVisa(accessToken: AccessToken): Promise<GiftCard | null> {
  try {
    return await getGiftCardById(fallbackIntlVisa.sku, accessToken);
  } catch (e) {
    console.error(`Failed to load international US visa: ${JSON.stringify(fallbackIntlVisa)}\n${e}`);
    return null;
  }
}

export async function getGiftCards(productQuery: string, country: string, accessToken: AccessToken): Promise<GiftCard[]> {
  if (accessToken.isSandbox) {
    // Load product differently on Reloadly sandbox
    // Sandbox doesn't have mastercard, it has only 1 visa card for US.
    // This visa card doesn't load with location based url, let's use special url
    // for this so that we have something to try on sandbox
    return await getSandboxGiftCards(productQuery, country, accessToken);
  }
  // productCategoryId = 1 = Finance.
  // This should prevent mixing of other gift cards with similar keywords
  const url = `${getBaseUrl(accessToken.isSandbox)}/countries/${country}/products?productName=${productQuery}&productCategoryId=1`;

  console.log(`Retrieving gift cards from ${url}`);
  const options = {
    method: "GET",
    headers: {
      ...commonHeaders,
      Authorization: `Bearer ${accessToken.token}`,
    },
  };

  const response = await fetch(url, options);
  const responseJson = await response.json();

  console.log("Response status", response.status);
  console.log(`Response from ${url}`, responseJson);

  if (response.status == 404) {
    return [];
  }

  if (response.status != 200) {
    throw new Error(
      `Error from Reloadly API: ${JSON.stringify({
        status: response.status,
        message: (responseJson as ReloadlyFailureResponse).message,
      })}`
    );
  }

  return responseJson as GiftCard[];
}

async function getSandboxGiftCards(productQuery: string, country: string, accessToken: AccessToken): Promise<GiftCard[]> {
  const url = `${getBaseUrl(accessToken.isSandbox)}/products?productName=${productQuery}&productCategoryId=1`;

  console.log(`Retrieving gift cards from ${url}`);
  const options = {
    method: "GET",
    headers: {
      ...commonHeaders,
      Authorization: `Bearer ${accessToken.token}`,
    },
  };

  const response = await fetch(url, options);
  const responseJson = await response.json();

  console.log("Response status", response.status);
  console.log(`Response from ${url}`, responseJson);

  if (response.status == 404) {
    return [];
  }

  if (response.status != 200) {
    throw new Error(
      `Error from Reloadly API: ${JSON.stringify({
        status: response.status,
        message: (responseJson as ReloadlyFailureResponse).message,
      })}`
    );
  }

  return (responseJson as { content: GiftCard[] })?.content;
}
