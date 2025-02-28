Rook13

##User Interface Flow##
Account and Lobby Management
Login: Players sign in to access the game.
Create Account: New players register for an account.
Logout: Players can log out when finished.
Lobby: A waiting area where players see active games and can join one.
Player Profile: See player stats and game histories.


##Overview##
Rook13 is played by 4 players divided into 2 teams. The game is played over a series of “hands” (mini-games) until one team’s cumulative score exceeds +500 or falls below –250. Each hand involves dealing cards, bidding on points, playing a series of tricks, and scoring based on the cards won.
Bots can be substituted for human players.

##Key Concepts and Definitions##
Players and Teams
Player: A user of the app.
Seat: There are 4 fixed seats, labeled A1, B1, A2, and B2. Once a player takes a seat at the start of the game, they remain in that seat for the entire game.
Team: Two players sitting directly across from each other form a team:
Team A: Seats A1 and A2.
Team B: Seats B1 and B2.
GameScore: The cumulative score for each team, which is the sum of the scores from all completed hands played.
Cards and the Deck
Deck: Consists of 40 cards divided equally among 4 suits (Red, Yellow, Black, and Green). Each suit contains cards numbered from 5 through 14.
Card: Each card has:
A suit (its color).
A number (from 5 to 14).
A point value (only certain cards “count” for points):
Cards numbered 5 are worth 5 points.
Cards numbered 10 are worth 10 points.
Cards numbered 13 are worth 10 points.
Hand (of Cards): The complete 40-card set used in one mini-game.

##Game Components##
###Dealing and Hands###
PlayersHand: At the start of each hand, every player is randomly dealt 9 cards. These cards are private. Players can rearange their cards as they please.
Widow: In addition to the players’ cards, 4 extra cards are dealt face down. They remain hidden to all players until they are revealed and given to only the player who “takes it” during bidding. 

###Roles and Special Terms###
HandDealer: The player designated as the dealer for the current hand. This role rotates clockwise each hand.
BidLead: The player immediately clockwise from the dealer who starts the bidding process.
Bid: A player’s declaration of the minimum number of points they believe their team can win. The valid bids are: 65, 70, 75, 80, 85, 90, 95, 100, 105, 110, 115, and 120. A player may also choose to “Pass.” Once a player passes, they cannot bid again. The bidding continues clockwise until three players have passed. (If the first three players pass, the last player must bid.)
BidWinner: The last remaining bidder who wins the bid. This player:
Adds the 4 Widow cards to their hand.
Selects 4 cards from their combined hand (now including the Widow) to set aside as the GoDown.
Declares the trump suit for the hand.
GoDown: The 4 cards selected by the BidWinner that are set aside (hidden until later). Their points count only after the final trick.
Trump: The suit declared by the BidWinner, which will have the highest power during trick-taking.

###Playing the Hand###
####Trick Play####
Trick: A mini-game where each of the 4 players plays one card, for a total of 9 tricks per hand.
TrickLead: The player who plays the first card in a trick:
For the first trick, this is the BidLead.
For subsequent tricks, it is the player who won the previous trick.
TrickTurn: The player whose turn it is to play in the current trick, following a clockwise order.
PlayACard: The act of placing a card from your hand on the table during your turn.
LeadSuit: The suit of the first card played in a trick.
FollowingSuit: A rule that requires the other players to play a card of the LeadSuit if they have one. If a player does not have a card matching the LeadSuit, they may play any card.
TrickCapture: Determining the winner of the trick:
If one or more trump cards are played, the highest trump wins the trick.
If no trump cards are played, the highest card in the LeadSuit wins the trick.
Scoring the Hand
HandScore: The total points captured by each team during the hand. Points come from:
The individual point values on the cards won in tricks.
The GoDown, which is revealed and scored after the last trick.
A bonus of 20 points if a team wins 5 or more tricks (known as TakingTricks Bonus).
LastTrick Bonus: The player who wins the 9th (last) trick also claims the GoDown, adding its point values to their team’s score.
Going Set: If the team of the BidWinner fails to capture enough points to meet or exceed the bid, that hand’s score becomes a negative value equal to the bid (for example, –100 if the bid was 100).

###Special Condition###
Redeal: If any player is dealt only cards numbered 6, 7, 8, or 9, the hand is considered too weak, and the entire deal is redone.

###Phases of the Game###
1. Game Initialization
Start New Game: Begin a new game session.
Open Game: The game is made available for players to join or bots are assigned.
Request Join: Players send a request to join the game.
Active Game: Once 4 players have joined, the game becomes active.
2. Game Setup
Select Teams: Based on fixed seats, teams are automatically formed (Team A: A1 & A2; Team B: B1 & B2).
Select Dealer: One player is chosen as the dealer. This role rotates clockwise after each hand.
3. Playing a Hand
Dealing:
The dealer clicks “deal cards” which gives 9 cards to each player.
4 cards are dealt to the Widow.
The dealer can click “redeal” during the dealing phase which readeals all the cards. Occasionally this is useful when playing.
Bidding:
The BidLead starts the bidding process.
Players bid (or pass) in clockwise order until three players have passed.
The remaining player becomes the BidWinner.
Selecting the GoDown and Trump:
The BidWinner adds the Widow to their hand.
They choose 4 cards to remove from their hand as the GoDown.
They then declare the trump suit for that hand.
Playing Tricks:
Nine tricks are played.
The first trick is led by the BidLead; subsequent tricks are led by the winner of the previous trick.
Players must follow the LeadSuit if possible.
The trick is won either by the highest trump card or, if no trumps are played, by the highest card of the LeadSuit.
Revealing and Scoring:
After the 9th trick, the GoDown is revealed and its points are added to the team that won the last trick.
Points from the tricks, any bonus for taking 5 or more tricks, and the GoDown are totaled to form the HandScore.
If the BidWinner’s team does not meet or exceed the bid, the hand’s score becomes a negative value equal to the bid.
The HandScore is added to the cumulative GameScore for each team.
4. Continuing or Ending the Game
Next Hand:
The role of dealer rotates to the next player (clockwise).
A new hand begins following the same process.
Game End:
The game continues until one team’s cumulative score goes over +500 or drops below –250.
At that point, the game is completed and the winning team is determined.


