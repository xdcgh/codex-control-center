import {Component,type ReactNode} from 'react';
export default class PageBoundary extends Component<{children:ReactNode;page:string},{failed:boolean}>{
 state={failed:false};
 static getDerivedStateFromError(){return {failed:true};}
 render(){if(this.state.failed)return <section className="panel" role="alert"><h2>{this.props.page} could not be displayed</h2><p>The page renderer rejected the current data shape. No values are substituted. Navigation and the background owner remain available. Open Diagnostics for source status.</p><button onClick={()=>this.setState({failed:false})}>Retry page</button></section>;return this.props.children;}
}
