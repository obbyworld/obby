import type { IRCClientContext } from "../IRCClientContext";
import {
  handleAuthenticate,
  handleExtjwt,
  handleFail,
  handleNote,
  handlePersistence,
  handleRegister,
  handleSuccess,
  handleToken,
  handleTwoFA,
  handleVerify,
  handleWarn,
} from "./auth";
import {
  handleListChannel,
  handleListEnd,
  handleMode,
  handleNames,
  handleRename,
  handleRplBanList,
  handleRplChannelModeIs,
  handleRplEndOfBanList,
  handleRplEndOfExceptList,
  handleRplEndOfInviteList,
  handleRplExceptList,
  handleRplInviteList,
  handleRplNoTopic,
  handleRplTopic,
  handleRplTopicWhoTime,
  handleTopic,
} from "./channels";
import { handleCmdslist } from "./cmdslist";
import {
  handleCap,
  handleError,
  handleIsupport,
  handlePing,
  handlePong,
  handleRplWelcome,
  handleRplYoureOper,
  handleRplYourHost,
  handleSaslFailure,
  handleSaslSuccess,
} from "./connection";
import { handleInvitelink } from "./invitelink";
import {
  handleBatch,
  handleNotice,
  handlePrivmsg,
  handleRedact,
  handleTagmsg,
} from "./messages";
import {
  handleMetadata,
  handleMetadataFail,
  handleMetadataKeyNotSet,
  handleMetadataKeyValue,
  handleMetadataSubOk,
  handleMetadataSubs,
  handleMetadataSyncLater,
  handleMetadataUnsubOk,
  handleMetadataWhoisKeyValue,
} from "./metadata";
import {
  handleEndOfMonList,
  handleMonList,
  handleMonListFull,
  handleMonOffline,
  handleMonOnline,
} from "./monitoring";
import {
  handleProp,
  handleRplChmodelist,
  handleRplEndOfListProplist,
  handleRplEndOfProplist,
  handleRplListProplist,
  handleRplProplist,
  handleRplUmodelist,
} from "./named-modes";
import { handleMarkread } from "./readMarker";
import {
  handleAway,
  handleChghost,
  handleInvite,
  handleJoin,
  handleKick,
  handleNick,
  handleNickError431,
  handleNickError432,
  handleNickError433,
  handleNickError436,
  handlePart,
  handleQuit,
  handleRplAway,
  handleRplInviting,
  handleRplNowaway,
  handleRplUnaway,
  handleSetname,
} from "./users";
import {
  handleWhoEnd,
  handleWhoisAccount,
  handleWhoisBot,
  handleWhoisChannels,
  handleWhoisEnd,
  handleWhoisIdle,
  handleWhoisSecure,
  handleWhoisServer,
  handleWhoisSpecial,
  handleWhoisUser,
  handleWhoReply,
  handleWhoxReply,
} from "./whois";

// trailing is passed separately because the CAP handler uses it directly
// (it is also present as the last parv element, but CAP has special logic for it)
export type HandlerFn = (
  ctx: IRCClientContext,
  serverId: string,
  source: string,
  parv: string[],
  mtags: Record<string, string> | undefined,
  trailing: string,
) => void;

export const IRC_DISPATCH: Record<string, HandlerFn> = {
  PING: (ctx, serverId, source, parv, mtags, trailing) =>
    handlePing(ctx, serverId, source, parv),
  PONG: (ctx, serverId, source, parv) =>
    handlePong(ctx, serverId, source, parv),
  ERROR: (ctx, serverId, source, parv) =>
    handleError(ctx, serverId, source, parv),
  "001": (ctx, serverId, source, parv) =>
    handleRplWelcome(ctx, serverId, source, parv),
  "002": (ctx, serverId, source, parv) =>
    handleRplYourHost(ctx, serverId, source, parv),
  "005": (ctx, serverId, source, parv) =>
    handleIsupport(ctx, serverId, source, parv),
  CAP: (ctx, serverId, source, parv, mtags, trailing) =>
    handleCap(ctx, serverId, source, parv, mtags, trailing),
  "381": (ctx, serverId, source, parv) =>
    handleRplYoureOper(ctx, serverId, source, parv),

  // SASL authentication successful (901, 902, 903): finish CAP negotiation
  "901": (ctx, serverId, source, parv) =>
    handleSaslSuccess(ctx, serverId, source, parv),
  "902": (ctx, serverId, source, parv) =>
    handleSaslSuccess(ctx, serverId, source, parv),
  "903": (ctx, serverId, source, parv) =>
    handleSaslSuccess(ctx, serverId, source, parv),
  // SASL failure: 904-907
  "904": (ctx, serverId, source, parv) =>
    handleSaslFailure(ctx, serverId, source, parv),
  "905": (ctx, serverId, source, parv) =>
    handleSaslFailure(ctx, serverId, source, parv),
  "906": (ctx, serverId, source, parv) =>
    handleSaslFailure(ctx, serverId, source, parv),
  "907": (ctx, serverId, source, parv) =>
    handleSaslFailure(ctx, serverId, source, parv),

  PRIVMSG: (ctx, serverId, source, parv, mtags) =>
    handlePrivmsg(ctx, serverId, source, parv, mtags),
  NOTICE: (ctx, serverId, source, parv, mtags) =>
    handleNotice(ctx, serverId, source, parv, mtags),
  TAGMSG: (ctx, serverId, source, parv, mtags) =>
    handleTagmsg(ctx, serverId, source, parv, mtags),
  REDACT: (ctx, serverId, source, parv, mtags) =>
    handleRedact(ctx, serverId, source, parv, mtags),
  BATCH: (ctx, serverId, source, parv, mtags) =>
    handleBatch(ctx, serverId, source, parv, mtags),

  NICK: (ctx, serverId, source, parv, mtags) =>
    handleNick(ctx, serverId, source, parv, mtags),
  QUIT: (ctx, serverId, source, parv, mtags) =>
    handleQuit(ctx, serverId, source, parv, mtags),
  AWAY: (ctx, serverId, source, parv, mtags) =>
    handleAway(ctx, serverId, source, parv, mtags),
  CHGHOST: (ctx, serverId, source, parv, mtags) =>
    handleChghost(ctx, serverId, source, parv, mtags),
  JOIN: (ctx, serverId, source, parv, mtags) =>
    handleJoin(ctx, serverId, source, parv, mtags),
  PART: (ctx, serverId, source, parv, mtags) =>
    handlePart(ctx, serverId, source, parv, mtags),
  KICK: (ctx, serverId, source, parv, mtags) =>
    handleKick(ctx, serverId, source, parv, mtags),
  INVITE: (ctx, serverId, source, parv, mtags) =>
    handleInvite(ctx, serverId, source, parv, mtags),
  "341": (ctx, serverId, source, parv, mtags) =>
    handleRplInviting(ctx, serverId, source, parv, mtags),
  SETNAME: (ctx, serverId, source, parv, mtags) =>
    handleSetname(ctx, serverId, source, parv, mtags),
  "305": (ctx, serverId, source, parv, mtags) =>
    handleRplUnaway(ctx, serverId, source, parv, mtags),
  "306": (ctx, serverId, source, parv, mtags) =>
    handleRplNowaway(ctx, serverId, source, parv, mtags),
  "301": (ctx, serverId, source, parv, mtags) =>
    handleRplAway(ctx, serverId, source, parv, mtags),
  "431": (ctx, serverId, source, parv, mtags) =>
    handleNickError431(ctx, serverId, source, parv, mtags),
  "432": (ctx, serverId, source, parv, mtags) =>
    handleNickError432(ctx, serverId, source, parv, mtags),
  "433": (ctx, serverId, source, parv, mtags) =>
    handleNickError433(ctx, serverId, source, parv, mtags),
  "436": (ctx, serverId, source, parv, mtags) =>
    handleNickError436(ctx, serverId, source, parv, mtags),

  MODE: (ctx, serverId, source, parv, mtags) =>
    handleMode(ctx, serverId, source, parv, mtags),
  TOPIC: (ctx, serverId, source, parv, mtags) =>
    handleTopic(ctx, serverId, source, parv, mtags),
  "332": (ctx, serverId, source, parv, mtags) =>
    handleRplTopic(ctx, serverId, source, parv, mtags),
  "333": (ctx, serverId, source, parv, mtags) =>
    handleRplTopicWhoTime(ctx, serverId, source, parv, mtags),
  "331": (ctx, serverId, source, parv, mtags) =>
    handleRplNoTopic(ctx, serverId, source, parv, mtags),
  RENAME: (ctx, serverId, source, parv, mtags) =>
    handleRename(ctx, serverId, source, parv, mtags),
  "353": (ctx, serverId, source, parv, mtags) =>
    handleNames(ctx, serverId, source, parv, mtags),
  "322": (ctx, serverId, source, parv, mtags) =>
    handleListChannel(ctx, serverId, source, parv, mtags),
  "323": (ctx, serverId, source, parv, mtags) =>
    handleListEnd(ctx, serverId, source, parv, mtags),
  "324": (ctx, serverId, source, parv, mtags) =>
    handleRplChannelModeIs(ctx, serverId, source, parv, mtags),
  "367": (ctx, serverId, source, parv, mtags) =>
    handleRplBanList(ctx, serverId, source, parv, mtags),
  "346": (ctx, serverId, source, parv, mtags) =>
    handleRplInviteList(ctx, serverId, source, parv, mtags),
  "348": (ctx, serverId, source, parv, mtags) =>
    handleRplExceptList(ctx, serverId, source, parv, mtags),
  "368": (ctx, serverId, source, parv, mtags) =>
    handleRplEndOfBanList(ctx, serverId, source, parv, mtags),
  "347": (ctx, serverId, source, parv, mtags) =>
    handleRplEndOfInviteList(ctx, serverId, source, parv, mtags),
  "349": (ctx, serverId, source, parv, mtags) =>
    handleRplEndOfExceptList(ctx, serverId, source, parv, mtags),

  "311": (ctx, serverId, source, parv, mtags) =>
    handleWhoisUser(ctx, serverId, source, parv, mtags),
  "312": (ctx, serverId, source, parv, mtags) =>
    handleWhoisServer(ctx, serverId, source, parv, mtags),
  "317": (ctx, serverId, source, parv, mtags) =>
    handleWhoisIdle(ctx, serverId, source, parv, mtags),
  "318": (ctx, serverId, source, parv, mtags) =>
    handleWhoisEnd(ctx, serverId, source, parv, mtags),
  "319": (ctx, serverId, source, parv, mtags) =>
    handleWhoisChannels(ctx, serverId, source, parv, mtags),
  "320": (ctx, serverId, source, parv, mtags) =>
    handleWhoisSpecial(ctx, serverId, source, parv, mtags),
  "378": (ctx, serverId, source, parv, mtags) =>
    handleWhoisSpecial(ctx, serverId, source, parv, mtags),
  "379": (ctx, serverId, source, parv, mtags) =>
    handleWhoisSpecial(ctx, serverId, source, parv, mtags),
  "330": (ctx, serverId, source, parv, mtags) =>
    handleWhoisAccount(ctx, serverId, source, parv, mtags),
  "671": (ctx, serverId, source, parv, mtags) =>
    handleWhoisSecure(ctx, serverId, source, parv, mtags),
  "335": (ctx, serverId, source, parv, mtags) =>
    handleWhoisBot(ctx, serverId, source, parv, mtags),
  "352": (ctx, serverId, source, parv, mtags) =>
    handleWhoReply(ctx, serverId, source, parv, mtags),
  "354": (ctx, serverId, source, parv, mtags) =>
    handleWhoxReply(ctx, serverId, source, parv, mtags),
  "315": (ctx, serverId, source, parv, mtags) =>
    handleWhoEnd(ctx, serverId, source, parv, mtags),

  METADATA: (ctx, serverId, source, parv, mtags) =>
    handleMetadata(ctx, serverId, source, parv, mtags),
  "760": (ctx, serverId, source, parv, mtags) =>
    handleMetadataWhoisKeyValue(ctx, serverId, source, parv, mtags),
  "761": (ctx, serverId, source, parv, mtags) =>
    handleMetadataKeyValue(ctx, serverId, source, parv, mtags),
  "766": (ctx, serverId, source, parv, mtags) =>
    handleMetadataKeyNotSet(ctx, serverId, source, parv, mtags),
  "770": (ctx, serverId, source, parv, mtags) =>
    handleMetadataSubOk(ctx, serverId, source, parv, mtags),
  "771": (ctx, serverId, source, parv, mtags) =>
    handleMetadataUnsubOk(ctx, serverId, source, parv, mtags),
  "772": (ctx, serverId, source, parv, mtags) =>
    handleMetadataSubs(ctx, serverId, source, parv, mtags),
  "774": (ctx, serverId, source, parv, mtags) =>
    handleMetadataSyncLater(ctx, serverId, source, parv, mtags),

  AUTHENTICATE: (ctx, serverId, source, parv, mtags) =>
    handleAuthenticate(ctx, serverId, source, parv, mtags),
  // FAIL METADATA is a distinct protocol — route to the metadata handler
  FAIL: (ctx, serverId, source, parv, mtags, trailing) =>
    parv[0] === "METADATA"
      ? handleMetadataFail(ctx, serverId, source, parv, mtags)
      : handleFail(ctx, serverId, source, parv, mtags, trailing),
  WARN: (ctx, serverId, source, parv, mtags, trailing) =>
    handleWarn(ctx, serverId, source, parv, mtags, trailing),
  NOTE: (ctx, serverId, source, parv, mtags, trailing) =>
    handleNote(ctx, serverId, source, parv, mtags, trailing),
  SUCCESS: (ctx, serverId, source, parv, mtags, trailing) =>
    handleSuccess(ctx, serverId, source, parv, mtags, trailing),
  REGISTER: (ctx, serverId, source, parv, mtags, trailing) =>
    handleRegister(ctx, serverId, source, parv, mtags, trailing),
  VERIFY: (ctx, serverId, source, parv, mtags) =>
    handleVerify(ctx, serverId, source, parv, mtags),
  TOKEN: (ctx, serverId, source, parv, mtags) =>
    handleToken(ctx, serverId, source, parv, mtags),
  "2FA": (ctx, serverId, source, parv, mtags) =>
    handleTwoFA(ctx, serverId, source, parv, mtags),
  EXTJWT: (ctx, serverId, source, parv, mtags) =>
    handleExtjwt(ctx, serverId, source, parv, mtags),
  PERSISTENCE: (ctx, serverId, source, parv, mtags) =>
    handlePersistence(ctx, serverId, source, parv, mtags),
  INVITELINK: (ctx, serverId, source, parv, mtags) =>
    handleInvitelink(ctx, serverId, source, parv, mtags),
  MARKREAD: (ctx, serverId, source, parv, mtags) =>
    handleMarkread(ctx, serverId, source, parv, mtags),
  CMDSLIST: (ctx, serverId, source, parv, mtags) =>
    handleCmdslist(ctx, serverId, source, parv, mtags),

  PROP: (ctx, serverId, source, parv, mtags) =>
    handleProp(ctx, serverId, source, parv, mtags),
  "960": (ctx, serverId, source, parv, mtags) =>
    handleRplEndOfProplist(ctx, serverId, source, parv, mtags),
  "961": (ctx, serverId, source, parv, mtags) =>
    handleRplProplist(ctx, serverId, source, parv, mtags),
  "962": (ctx, serverId, source, parv, mtags) =>
    handleRplEndOfListProplist(ctx, serverId, source, parv, mtags),
  "963": (ctx, serverId, source, parv, mtags) =>
    handleRplListProplist(ctx, serverId, source, parv, mtags),
  "964": (ctx, serverId, source, parv, mtags) =>
    handleRplChmodelist(ctx, serverId, source, parv, mtags),
  "965": (ctx, serverId, source, parv, mtags) =>
    handleRplUmodelist(ctx, serverId, source, parv, mtags),

  "730": (ctx, serverId, source, parv, mtags) =>
    handleMonOnline(ctx, serverId, source, parv, mtags),
  "731": (ctx, serverId, source, parv, mtags) =>
    handleMonOffline(ctx, serverId, source, parv, mtags),
  "732": (ctx, serverId, source, parv, mtags) =>
    handleMonList(ctx, serverId, source, parv, mtags),
  "733": (ctx, serverId, source, parv, mtags) =>
    handleEndOfMonList(ctx, serverId, source, parv, mtags),
  "734": (ctx, serverId, source, parv, mtags) =>
    handleMonListFull(ctx, serverId, source, parv, mtags),
};
