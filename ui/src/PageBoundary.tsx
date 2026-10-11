import {t} from "./i18n";
import {Component,type ReactNode} from 'react';
export default class PageBoundary extends Component<{children:ReactNode;page:string},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){if(this.state.failed)return <section className="panel" role="alert"><h2>{this.props.page} {t("could not be displayed")}</h2><p>{t("The page renderer rejected the current data shape. No values are substituted. Navigation and the background owner remain available. Open Diagnostics for source status.")}</p><button onClick={()=>this.setState({failed:false})}>{t("Retry page")}</button></section>;return this.props.children;}
}
