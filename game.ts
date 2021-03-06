
import { Buzzer } from 'node-buzzer';
import { WebGameUI } from './web_game_ui';
import { WebMasterUI } from './web_master_ui';
import { GameUI } from './game_ui';
import { QuestionLoader, QuestionList } from './question_loader';
import { Question, BlindQuestion, DeafQuestion } from './question';
import { Team } from './team';

export class Game {
	// The buzzer interface
	buzzer: Buzzer;

	// The UIs (game + master)
	gameUI: GameUI;
	masterUI: GameUI;

	// Is the game started, i.e. all actors has been connected once
	started: boolean;

	// The number of activated teams. Used to prevent starting the questions if not enough participants or 
	// to automatically go to the questions (desabled for now)
	activatedTeams: number;

	// The current step
	step: string;

	// The current mode (random order of questions or not)
	mode: string;

	// The teams
	teams: Array<Team>;
	stopTeamActivation: Function;
	stopTeamActivationTimeout: any;
	questions: QuestionList;
	questionIndex: number;
	answers: Array<Array<number>>;
	answerWaitingForValidation: number;
	actors: { buzzer: boolean, game: boolean, master: boolean };
	teamActivationDuration: number;
	finished: boolean;

	constructor(buzzer:Buzzer, gameUI: GameUI, masterUI: GameUI) {
		this.buzzer = buzzer;
		this.gameUI = gameUI;
		this.masterUI = masterUI;
		this.actors = { buzzer: false, game: false, master: false };
		this.teamActivationDuration = 60;

		this.started = false;
		this.questions = null;
		this.answers = [];
		this.questionIndex = -1;
		this.answerWaitingForValidation = null;

		/** 
		 * Ready
		 */
		var buzzerReady = false, gameReady = false, masterReady = false;
		this.buzzer.addEventListener('ready', () => {
			var max = this.buzzer.controllersCount();
			// Make sur all buzzer are off
			for (var i=0; i < max; i++) {
				this.buzzer.lightOff(i);
			}

			this.actors.buzzer = true;
			this.ready();
		});

		this.gameUI.addEventListener('ready', () => {
			this.actors.game = true;
			this.gameUI.setGame(this);
			this.ready();
		});

		this.masterUI.addEventListener('ready', () => {
			this.actors.master = true;
			this.masterUI.setGame(this);
			this.ready();
		});

		/**
		 * Leave
		 */
		this.buzzer.addEventListener('leave', () => {
			this.actors.buzzer = false;
			this.leave();
		});

		this.gameUI.addEventListener('leave', () => {
			this.actors.game = false;
			this.leave();
		});

		this.masterUI.addEventListener('leave', () => {
			this.actors.master = false;
			this.leave();
		});
	}

	ready() {
		this.gameUI.setActors(this.actors);
		this.masterUI.setActors(this.actors);

		if (this.actors.buzzer && this.actors.game && this.actors.master) {
			if (!this.isStarted()) {
				this.start();
			} else {
				
				// Sets the right step
				this.gameUI.setStep(this.step);
				this.masterUI.setStep(this.step);

				// If mode available, set it
				if (this.mode) {
					this.gameUI.setMode(this.mode);
					this.masterUI.setMode(this.mode);
				}

				// Sets the questions
				if (this.questions.length() && !this.finished) {
					this.gameUI.setQuestions(this.questions.all());
					this.masterUI.setQuestions(this.questions.all());
				}
				
				// Sets the teams and be sure that they are not active
				this.teams.forEach(function(team) {
					team.lightOn = false;
				});
				this.gameUI.setTeams(this.teams);
				this.masterUI.setTeams(this.teams);

				// Finish the game or set the question if questions were started
				if (this.finished) {
					this.finishGame();
				} else if (this.questionIndex >= 0) {
					this.setQuestion(this.questions.get(this.questionIndex));
				}
			}
		}
	}

	leave() {
		this.gameUI.setActors(this.actors);
		this.masterUI.setActors(this.actors);
	}

	start() {
		this.step = '';
		this.started = true;
		this.finished = false;
		this.activatedTeams = 0;
		this.initTeam();
		this.modeStep();
	}

	initTeam() {
		var letters = 'ABCDEFGHIJKLMNOPQRST'.split('');
		this.teams = new Array(this.buzzer.controllersCount())
			.join()
			.split(',')
			.map((v, index) => {
				return {
					name: letters[index],
					id: letters[index].toLowerCase(),
					active: false,
					lightOn: false,
					flash: false,
					points: 0
				}
			});
	}

	setTeamName(data) {
		this.teams.filter((team:Team, index:Number):boolean => {
			return team.id == data.id;
		}).map((team: Team) => {
			team.name = data.name;
			this.gameUI.updateTeam(team);
			this.masterUI.updateTeam(team);
		});
	}

	isStarted() {
		return this.started;
	}

	stop() {
		if (!this.isStarted()) {
			return;
		}
	}

	//
	// Mode step
	//
	setMode(mode: string) {
		this.mode = mode;
		this.loadQuestions(mode);
		this.gameUI.setMode(this.mode);
	}

	modeStep() {
		this.step = 'mode';
		this.gameUI.setStep(this.step);
		this.masterUI.setStep(this.step);
	}

	activationStep() {
		

		//this.gameUI.setTeamActivationDuration(this.teamActivationDuration);
		//this.masterUI.setTeamActivationDuration(this.teamActivationDuration);

		// Send the teams to uis
		this.gameUI.setTeams(this.teams);
		this.masterUI.setTeams(this.teams);

		// Go to teams-activation step 
		this.step = 'teams-activation';
		this.gameUI.setStep(this.step);
		this.masterUI.setStep(this.step);

		this.stopTeamActivation = this.buzzer.onPress((controllerIndex:number, buttonIndex:number) => {
			this.activateTeam(controllerIndex);
		});

		// Go to next step after a timeout
		this.stopTeamActivationTimeout = setTimeout(() => {
			//this.quizzStep();
		}, this.teamActivationDuration * 1000);
	}

	quizzStep() {
		if (this.activatedTeams < 2) {
			this.modeStep();
			return;
		}

		// Stop the team activation
		this.stopTeamActivation();
		if (this.stopTeamActivationTimeout) {
			clearTimeout(this.stopTeamActivationTimeout);
		}

		// Turn off teams
		this.teams.forEach((team, index) => {
			team.lightOn = false;
			this.buzzer.lightOff(index);
			this.gameUI.updateTeam(team);
			this.masterUI.updateTeam(team);
		});

		this.gameUI.setQuestions(this.questions.all());
		this.masterUI.setQuestions(this.questions.all());

		// Go to step 3 : showing questions
		this.step = 'questions';
		this.gameUI.setStep(this.step);
		this.masterUI.setStep(this.step);

		this.buzzer.onPress((controllerIndex:number, buttonIndex:number) => {
			console.log('Press on '+controllerIndex);
			if (this.questionIndex == -1 || this.answerWaitingForValidation != null) {
				console.log('Waiting for validation or no question');
				return;
			}
			var qAnswers = this.answers[this.questionIndex];
			if (qAnswers[controllerIndex] == -1) {
				this.buzzed(controllerIndex);
			} else {
				console.log('already answered :(')
			}
		});
	}

	startQuestion(questionIndex: number) {
		this.questionIndex = questionIndex;
		this.answers[this.questionIndex] = new Array(this.buzzer.controllersCount())
			.join()
			.split(',')
			.map(() => {
				return -1;
			});
		this.answerWaitingForValidation = null;
		this.masterUI.startQuestion(questionIndex);
		this.gameUI.startQuestion(questionIndex);
	}

	continueQuestion(questionIndex: number) {
		//this.questionIndex = questionIndex;
		this.answerWaitingForValidation = null;
		this.masterUI.continueQuestion(questionIndex);
		this.gameUI.continueQuestion(questionIndex);
	}

	//
	// Question step
	//

	validateAnswer(answer) {
		var controllerIndex = this.answerWaitingForValidation;
		var team = this.teams[controllerIndex];

		team.points += answer.points;
		team.lightOn = false;

		if (answer.points != 0) {
			team.flash = true;
		}
		

		this.answers[this.questionIndex][controllerIndex] = (answer.success) ? 1 : 0;

		// Light the buzzer on
		this.buzzer.lightOff(controllerIndex);

		this.gameUI.updateTeam(team);
		this.masterUI.updateTeam(team);

		team.flash = false;

		answer.teamIndex = controllerIndex;

		this.gameUI.validateAnswer(answer);
		this.masterUI.validateAnswer(answer);
	}


	//
	// Steps
	//

	activateTeam(controllerIndex: number) {
		var team = this.teams[controllerIndex];

		// make sure a team can only be activated once
		if (team.active) {
			return;
		}

		// Count the activated teams
		this.activatedTeams++;

		// Light the buzzer on
		this.buzzer.lightOn(controllerIndex);

		// Activate the team
		team.active = true;
		team.lightOn = true;
		team.flash = true;
		this.gameUI.activateTeam(team, true);
		this.masterUI.activateTeam(team, true);
		team.flash = false; // Just flash during activation

		// If all teams are activated, go to next step
		if (this.activatedTeams == this.buzzer.controllersCount()) {
			//this.quizzStep();
		}
	}

	

	buzzed(controllerIndex: number) {
		var team = this.teams[controllerIndex];

		// Flash the team that has buzzed
		team.flash = true;
		team.lightOn = true;
		this.gameUI.updateTeam(team);
		this.masterUI.updateTeam(team);
		team.flash = false;

		// Light the buzzer on
		this.buzzer.lightOn(controllerIndex);

		// Just pause the game
		this.answerWaitingForValidation = controllerIndex;
		this.gameUI.setAnswered(controllerIndex, true);
		this.masterUI.setAnswered(controllerIndex, true);
	}

	setQuestion(question: Question) {
		this.answerWaitingForValidation = null;
		this.gameUI.setQuestion(question);
		this.masterUI.setQuestion(question);
	}

	nextQuestion() {
		this.questionIndex++;

		if (this.questionIndex == this.questions.length()) {
			//this.end();
		}

		this.answers[this.questionIndex] = new Array(this.buzzer.controllersCount())
			.join()
			.split(',')
			.map(() => {
				return -1;
			});

		// Send the next question to uis
		var question:Question = this.questions.next();
		this.setQuestion(question);
	}

	loadQuestions(mode) {
		var directory = './questions';
		var ql = new QuestionLoader();
		this.questions = null;
		ql.load(directory, mode, (questions:QuestionList) => {
			this.questions = questions;
			this.questions.map((question: Question) => {
				/*if (question.type == 'blind') {
					(question as BlindQuestion).loadInformations(() => {});
					//loadMp3Informations(question, () => {});
				}*/
				question.loadInformations(() => {});
			});
		});
	}

	finishGame() {
		this.step = 'scores';
		this.gameUI.setStep(this.step);
		this.masterUI.setStep(this.step);

		this.finished = true;
		this.gameUI.finishGame();
		this.masterUI.finishGame();
	}

}
