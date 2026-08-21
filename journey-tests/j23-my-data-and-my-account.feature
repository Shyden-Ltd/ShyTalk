# j23 — Lena asks for her data, then asks to be forgotten.
#
# Personas: P-05 Lena (Web + Android — exercises both rights),
#           P-02 Alice (Web — the person left behind in a conversation),
#           P-07 Vexa (Web — tries to reach Lena's export),
#           P-12 Greta (Web Admin — sees what remains afterwards)
#
# Why this journey exists (SHY-0405): these are legal obligations under GDPR Article 20 and
# the right to erasure, and a journey audit of 471 scenarios found ZERO steps for either.
# `account_deletion_suggestions` says "When I delete my account" four times and asserts only
# what happens to a suggestion. Two facts make the gap worse than an ordinary one: the export
# secret already caused the module-load outage shape twice, and EXPORT_DOWNLOAD_SECRET is set
# in PRODUCTION — so live signed download links exist on a path nobody has ever walked. The
# deletion cron's own header records that the original sequence omitted the suggestions
# footprint, leaving deleted people identifiable by submitterUid, voterId and authorUid.

Feature: j23 — Lena takes her data and then leaves
  As someone exercising a legal right over my own data
  I want to be able to take a copy and then be forgotten
  So that the promise the privacy policy makes is one the product actually keeps

  Background:
    Given Lena [P-05] has an account with messages, purchases, follows and suggestions

  @blocker
  Scenario: Lena asks for a copy of her data
    When Lena on Web asks for a copy of her data
    Then Lena is told it is being prepared

  @blocker
  Scenario: The copy arrives and contains her data
    Given Lena's export has finished preparing
    When Lena on Web downloads it
    Then Lena receives a file containing her messages, purchases and follows

  @blocker
  Scenario: A brand-new account can still export
    Given Marcus [P-04] signed up moments ago and has almost no history
    When Marcus asks for a copy of his data
    Then Marcus receives a valid file

  @blocker @security
  Scenario: Nobody else can ask for Lena's data
    Given Lena has an account
    When Vexa [P-07] asks for a copy of Lena's data
    Then Vexa is refused

  @blocker @security
  Scenario: Nobody else can download Lena's export
    Given Lena's export is ready to download
    When Vexa opens Lena's download link
    Then Vexa is refused

  @blocker @security
  Scenario: An expired link stops working
    Given Lena's download link has expired
    When Lena on Web opens it
    Then Lena is told the link has expired

  @blocker @security
  Scenario: A tampered link is refused
    Given a download link whose signature has been altered
    When somebody opens it
    Then they are refused

  @blocker
  Scenario: Asking twice in quick succession is slowed down, not broken
    Given Lena has just asked for a copy of her data
    When Lena immediately asks again
    Then Lena is told to wait rather than shown an error

  # The 2026-08-19 outage shape: a secret checked at module load took every endpoint down.
  @blocker @regression
  Scenario: A missing export secret breaks only export
    Given the export secret is not configured
    When Alice [P-02] opens her wallet
    Then Alice's wallet works normally

  @blocker
  Scenario: Lena asks to be forgotten
    When Lena on Web asks for her account to be deleted
    Then Lena is told when it will happen

  @blocker
  Scenario: Lena can still use the app while she waits
    Given Lena has asked to be deleted and the date has not arrived
    When Lena on Android opens the app
    Then Lena can use it normally

  @blocker
  Scenario: Lena changes her mind
    Given Lena has asked to be deleted and the date has not arrived
    When Lena on Web cancels the deletion
    Then Lena's account continues as before

  @blocker
  Scenario: The deletion happens
    Given Lena's deletion date has passed and deletion has run
    When Lena tries to sign in
    Then Lena cannot get in

  @blocker @security
  Scenario: A deleted person is not still identifiable
    Given Lena voted on and submitted suggestions before she was deleted
    When Greta [P-12] looks through the suggestions for Lena
    Then nothing there identifies her

  @blocker
  Scenario: What survives shows as a deleted person, not a name
    Given Lena had an accepted suggestion before she was deleted
    When Alice reads that suggestion
    Then Alice sees it was written by a deleted person

  @blocker
  Scenario: Alice's side of the conversation survives
    Given Lena and Alice had a conversation before Lena was deleted
    When Alice opens that conversation
    Then Alice can still read her own side of it

  @blocker
  Scenario: Deleting the owner of an open room closes it
    Given Lena owns an open room and her deletion date has passed
    When deletion runs
    Then the room is closed

  @blocker @edge
  Scenario: More deletions than one run can process
    Given more accounts are due for deletion than a single run handles
    When deletion runs twice
    Then every due account has been deleted

  @blocker @security
  Scenario: Nobody else can schedule Lena's deletion
    Given Lena has an account
    When Vexa asks for Lena's account to be deleted
    Then Vexa is refused

  @i18n
  Scenario: Lena reads the deletion warning in her own language
    Given Lena's app is in German
    When Lena on Web opens the delete-account screen
    Then Lena reads in German what deletion will remove
